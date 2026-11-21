-- =====================================================================
-- 009: Eskalation überfälliger Rückgaben, tägliche Sicherung im System (mit Wiederherstellung),
--      Rückmeldungen der Nutzer, Fehlerbericht aus der App, Statusprüfung, Protokoll-Aufräumen.
-- Wiederholbar (idempotent).
-- =====================================================================

-- ---------- 1) Erinnerungen: Eskalation an die Verantwortlichen ----------
-- Zusätzlich zu 007: Ist eine Rückgabe seit mehr als 2 Tagen überfällig, erfahren es die Raum-Verantwortlichen (einmal pro Ausleihe).
create or replace function public.run_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare x record; v_count int := 0; v_link text;
begin
  -- 1) Rückgabe in den nächsten 24 Stunden fällig (einmalig pro Ausleihe)
  for x in select r.id, r.borrower_id, r.end_at, i.name from rentals r join items i on i.id = r.item_id
           where r.status = 'active' and r.end_at > now() and r.end_at <= now() + interval '24 hours'
             and not exists (select 1 from notifications n where n.link = 'rental:' || r.id and n.type = 'due_soon') loop
    perform notify_user(x.borrower_id, 'Rückgabe bald fällig', x.name || ' ist fällig am ' || to_char(x.end_at at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'), 'due_soon', 'rental:' || x.id);
    v_count := v_count + 1;
  end loop;
  -- 2) Überfällig (höchstens einmal pro 24 Stunden an die Person)
  for x in select r.id, r.borrower_id, r.end_at, i.name from rentals r join items i on i.id = r.item_id
           where r.status = 'active' and r.end_at < now()
             and not exists (select 1 from notifications n where n.link = 'rental:' || r.id and n.type = 'overdue' and n.created_at > now() - interval '24 hours') loop
    perform notify_user(x.borrower_id, 'Überfällig', x.name || ' war fällig am ' || to_char(x.end_at at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'), 'overdue', 'rental:' || x.id);
    v_count := v_count + 1;
  end loop;
  -- 2b) Eskalation: seit mehr als 2 Tagen überfällig -> Raum-Verantwortliche (einmalig pro Ausleihe)
  for x in select r.id, r.end_at, i.name, i.room_id, p.full_name from rentals r join items i on i.id = r.item_id left join profiles p on p.id = r.borrower_id
           where r.status = 'active' and r.end_at < now() - interval '2 days'
             and not exists (select 1 from notifications n where n.link = 'escalate:' || r.id) loop
    perform notify_managers(x.room_id, 'Überfällig seit über 2 Tagen',
      x.name || ' ist seit ' || to_char(x.end_at at time zone 'Europe/Berlin','DD.MM.YYYY') || ' nicht zurückgegeben' || case when coalesce(x.full_name,'') <> '' then ' (' || x.full_name || ')' else '' end,
      'overdue', 'escalate:' || x.id);
    v_count := v_count + 1;
  end loop;
  -- 3) Prüfung fällig (Wartungsintervall)
  for x in select i.id, i.name, i.room_id, i.next_inspection_at from items i
           where i.next_inspection_at is not null and i.next_inspection_at <= now() + interval '7 days' loop
    v_link := 'insp:' || x.id || ':' || to_char(x.next_inspection_at at time zone 'Europe/Berlin', 'YYYYMMDD');
    continue when exists (select 1 from notifications n where n.link = v_link);
    perform notify_managers(x.room_id, 'Prüfung fällig',
      x.name || ' (' || x.id || ') ist zur Prüfung fällig am ' || to_char(x.next_inspection_at at time zone 'Europe/Berlin', 'DD.MM.YYYY'), 'system', v_link);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public.run_reminders() from public, anon, authenticated;

-- ---------- 2) Sicherung im System ----------
create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null default 'auto' check (kind in ('auto','manual')),
  counts jsonb not null default '{}',
  data jsonb not null
);
alter table public.backups enable row level security;
drop policy if exists backups_admin_read on public.backups;
create policy backups_admin_read on public.backups for select using (public.is_admin());
revoke all on public.backups from anon, authenticated;
grant select on public.backups to authenticated;

-- Legt eine Sicherung an (Datenbank-Zeitplan oder Administrator). Behält 14 Tage lückenlos + jeden Sonntag 12 Wochen lang.
create or replace function public.create_backup(p_kind text default 'auto') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_data jsonb; v_counts jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Nur Administratoren dürfen Sicherungen anlegen'; end if;
  v_data := jsonb_build_object(
    'rooms',            coalesce((select jsonb_agg(to_jsonb(t)) from rooms t), '[]'),
    'items',            coalesce((select jsonb_agg(to_jsonb(t)) from items t), '[]'),
    'rentals',          coalesce((select jsonb_agg(to_jsonb(t)) from rentals t), '[]'),
    'inventory_counts', coalesce((select jsonb_agg(to_jsonb(t)) from inventory_counts t), '[]'),
    'activity_log',     coalesce((select jsonb_agg(to_jsonb(t)) from activity_log t), '[]'),
    'profiles',         coalesce((select jsonb_agg(jsonb_build_object('id',id,'username',username,'full_name',full_name,'role',role,'managed_room',managed_room)) from profiles), '[]'));
  v_counts := jsonb_build_object('items', jsonb_array_length(v_data->'items'), 'rentals', jsonb_array_length(v_data->'rentals'),
    'rooms', jsonb_array_length(v_data->'rooms'), 'activity_log', jsonb_array_length(v_data->'activity_log'), 'profiles', jsonb_array_length(v_data->'profiles'));
  insert into backups (kind, counts, data) values (case when p_kind = 'manual' then 'manual' else 'auto' end, v_counts, v_data) returning id into v_id;
  -- Aufräumen: automatische Sicherungen älter als 14 Tage nur behalten, wenn sie von einem Sonntag der letzten 12 Wochen sind
  delete from backups where kind = 'auto' and created_at < now() - interval '14 days'
    and (extract(dow from created_at at time zone 'Europe/Berlin') <> 0 or created_at < now() - interval '84 days');
  return v_id;
end $$;
revoke execute on function public.create_backup(text) from public, anon;
grant execute on function public.create_backup(text) to authenticated;

-- Stellt GELÖSCHTE Datensätze (Räume, Artikel, Ausleihen, Inventuren) aus einer Sicherung wieder her.
-- Bestehende Datensätze bleiben unverändert (nichts wird überschrieben); Unmögliches (z. B. Buchungskonflikt) wird übersprungen.
create or replace function public.restore_deleted_from_backup(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_data jsonb; r record; v_res jsonb := '{}'; v_ok int; v_skip int; t text;
begin
  if not public.is_admin() then raise exception 'Nur Administratoren dürfen wiederherstellen'; end if;
  select data into v_data from backups where id = p_id;
  if v_data is null then raise exception 'Sicherung nicht gefunden'; end if;
  foreach t in array array['rooms','items','rentals','inventory_counts'] loop
    v_ok := 0; v_skip := 0;
    for r in select value as j from jsonb_array_elements(v_data -> t) loop
      begin
        if t = 'rooms' then
          if not exists (select 1 from rooms where id = r.j->>'id') then insert into rooms select * from jsonb_populate_record(null::rooms, r.j); v_ok := v_ok + 1; end if;
        elsif t = 'items' then
          if not exists (select 1 from items where id = r.j->>'id') then insert into items select * from jsonb_populate_record(null::items, r.j); v_ok := v_ok + 1; end if;
        elsif t = 'rentals' then
          if not exists (select 1 from rentals where id = (r.j->>'id')::uuid) then insert into rentals select * from jsonb_populate_record(null::rentals, r.j); v_ok := v_ok + 1; end if;
        else
          if not exists (select 1 from inventory_counts where id = (r.j->>'id')::uuid) then insert into inventory_counts select * from jsonb_populate_record(null::inventory_counts, r.j); v_ok := v_ok + 1; end if;
        end if;
      exception when others then v_skip := v_skip + 1; end;
    end loop;
    v_res := v_res || jsonb_build_object(t, jsonb_build_object('wiederhergestellt', v_ok, 'übersprungen', v_skip));
  end loop;
  insert into activity_log (actor_id, action, item_name, details) values (auth.uid(), 'WIEDERHERGESTELLT', 'Sicherung ' || to_char((select created_at from backups where id = p_id) at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'), v_res);
  return v_res;
end $$;
revoke execute on function public.restore_deleted_from_backup(uuid) from public, anon;
grant execute on function public.restore_deleted_from_backup(uuid) to authenticated;

-- ---------- 3) Protokoll aufräumen (erst nach Export, nur Einträge älter als 90 Tage) ----------
create or replace function public.purge_activity_log(p_before timestamptz, p_expected int) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.is_admin() then raise exception 'Nur Administratoren dürfen das Protokoll aufräumen'; end if;
  if p_before > now() - interval '90 days' then raise exception 'Es dürfen nur Einträge gelöscht werden, die älter als 90 Tage sind'; end if;
  select count(*) into v_count from activity_log where created_at < p_before;
  if v_count <> p_expected then raise exception 'Die Anzahl hat sich geändert (jetzt %, erwartet %) – bitte den Export wiederholen', v_count, p_expected; end if;
  delete from activity_log where created_at < p_before;
  insert into activity_log (actor_id, action, item_name, details) values (auth.uid(), 'AUFGERÄUMT', 'Protokoll', jsonb_build_object('before', p_before, 'deleted', v_count));
  return v_count;
end $$;
revoke execute on function public.purge_activity_log(timestamptz, int) from public, anon;
grant execute on function public.purge_activity_log(timestamptz, int) to authenticated;

-- ---------- 4) Rückmeldungen der Nutzer ----------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null default 'idee' check (kind in ('idee','problem','lob')),
  message text not null check (char_length(btrim(message)) between 3 and 2000),
  page text check (page is null or char_length(page) <= 200),
  status text not null default 'neu' check (status in ('neu','gesehen','erledigt')),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists feedback_insert on public.feedback;
drop policy if exists feedback_read on public.feedback;
drop policy if exists feedback_admin_update on public.feedback;
create policy feedback_insert on public.feedback for insert to authenticated with check (user_id = auth.uid());
create policy feedback_read on public.feedback for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy feedback_admin_update on public.feedback for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert on public.feedback to authenticated;
grant update (status) on public.feedback to authenticated;

create or replace function public.trg_feedback_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in select id from profiles where role = 'admin' loop
    perform notify_user(a.id, 'Neue Rückmeldung', left(new.message, 120), 'system', 'feedback:' || new.id);
  end loop;
  return null;
end $$;
revoke execute on function public.trg_feedback_notify() from public, anon, authenticated;
drop trigger if exists feedback_notify on public.feedback;
create trigger feedback_notify after insert on public.feedback for each row execute function public.trg_feedback_notify();

-- ---------- 5) Fehlerbericht aus der App + Statusprüfung ----------
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  message text not null check (char_length(message) <= 500),
  stack text check (stack is null or char_length(stack) <= 4000),
  page text check (page is null or char_length(page) <= 200),
  agent text check (agent is null or char_length(agent) <= 300),
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;
drop policy if exists client_errors_insert on public.client_errors;
drop policy if exists client_errors_admin on public.client_errors;
create policy client_errors_insert on public.client_errors for insert to authenticated with check (user_id = auth.uid());
create policy client_errors_admin on public.client_errors for select to authenticated using (public.is_admin());
grant select, insert on public.client_errors to authenticated;

-- Einfache Statusprüfung für Überwachungsdienste (ohne Anmeldung aufrufbar, liefert keine Daten)
create or replace function public.ping() returns jsonb language sql stable as
$$ select jsonb_build_object('ok', true, 'time', now()) $$;
grant execute on function public.ping() to anon, authenticated;

-- ---------- 6) Zeitpläne (nur wenn pg_cron vorhanden ist) ----------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('lager-backup', 'lager-housekeeping');
    perform cron.schedule('lager-backup', '15 2 * * *', 'select public.create_backup(''auto'')');
    perform cron.schedule('lager-housekeeping', '30 3 * * *', $c$delete from public.client_errors where created_at < now() - interval '30 days'; delete from public.feedback where status = 'erledigt' and created_at < now() - interval '365 days'$c$);
  end if;
end $$;
