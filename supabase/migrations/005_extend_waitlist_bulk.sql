-- =====================================================================
-- 005: Frist verlängern (selbst bis 3 Tage, darüber Antrag), Warteliste, Sammel-Ausleihe
-- (nach 001-004 einmal ausführen, wiederholbar, löscht keine Daten)
-- =====================================================================

-- ---------- Verlängerungsanträge ----------
create table if not exists public.extension_requests (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  new_end_at timestamptz not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists extension_requests_status_idx on public.extension_requests(status, created_at);
alter table public.extension_requests enable row level security;
drop policy if exists ext_read on public.extension_requests;
create policy ext_read on public.extension_requests for select to authenticated using (
  requested_by = auth.uid()
  or exists (select 1 from rentals r join items i on i.id = r.item_id
             where r.id = extension_requests.rental_id and is_manager_for(i.room_id)));

-- Verlängern: Ausleiher selbst bis 3 Tage (nicht bei überfälligen Ausleihen), Verantwortliche immer; sonst Antrag
create or replace function public.extend_rental(p_rental_id uuid, p_new_end timestamptz, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r rentals; v_item items; v_manager boolean; v_days numeric; v_name text; v_req uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into r from rentals where id = p_rental_id for update;
  if not found or r.status <> 'active' then raise exception 'Ausleihe nicht gefunden oder bereits zurückgegeben'; end if;
  select * into v_item from items where id = r.item_id;
  v_manager := is_manager_for(v_item.room_id);
  if r.borrower_id <> auth.uid() and not v_manager then raise exception 'Keine Berechtigung'; end if;
  if p_new_end <= r.end_at then raise exception 'Das neue Rückgabedatum muss nach dem aktuellen liegen'; end if;
  if exists (select 1 from rentals o where o.item_id = r.item_id and o.id <> r.id and o.status = 'active'
             and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(r.start_at, p_new_end, '[)')) then
    raise exception 'Der Artikel ist danach bereits reserviert – Verlängerung nicht möglich';
  end if;
  v_days := extract(epoch from (p_new_end - r.end_at)) / 86400;

  if v_manager or (v_days <= 3 and r.end_at >= now()) then
    begin
      update rentals set end_at = p_new_end where id = r.id;
    exception when exclusion_violation then
      raise exception 'Der Artikel ist danach bereits reserviert – Verlängerung nicht möglich';
    end;
    update extension_requests set status = 'cancelled' where rental_id = r.id and status = 'pending';
    insert into activity_log (actor_id, subject_id, action, item_id, item_name, details)
      values (auth.uid(), r.borrower_id, 'VERLÄNGERUNG', r.item_id, v_item.name,
              jsonb_build_object('old_end', r.end_at, 'new_end', p_new_end, 'rental_id', r.id));
    perform notify_user(r.borrower_id, 'Frist verlängert', v_item.name || ' bis ' || to_char(p_new_end at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'), 'rental', 'rental:' || r.id);
    return 'extended';
  end if;

  if exists (select 1 from extension_requests where rental_id = r.id and status = 'pending') then
    raise exception 'Für diese Ausleihe liegt bereits ein offener Antrag vor';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bitte einen Grund für den Antrag angeben'; end if;
  insert into extension_requests (rental_id, requested_by, new_end_at, reason)
    values (r.id, auth.uid(), p_new_end, trim(p_reason)) returning id into v_req;
  select full_name into v_name from profiles where id = auth.uid();
  insert into activity_log (actor_id, subject_id, action, item_id, item_name, details)
    values (auth.uid(), r.borrower_id, 'ANTRAG', r.item_id, v_item.name,
            jsonb_build_object('new_end', p_new_end, 'note', trim(p_reason), 'rental_id', r.id));
  perform notify_managers(v_item.room_id, 'Verlängerungsantrag',
    coalesce(nullif(v_name, ''), 'Jemand') || ' möchte „' || v_item.name || '" bis ' || to_char(p_new_end at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') || ' verlängern.',
    'rental', 'ext:' || v_req);
  return 'requested';
end $$;

create or replace function public.decide_extension(p_request_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare q extension_requests; r rentals; v_item items;
begin
  select * into q from extension_requests where id = p_request_id for update;
  if not found or q.status <> 'pending' then raise exception 'Antrag nicht gefunden oder bereits entschieden'; end if;
  select * into r from rentals where id = q.rental_id for update;
  select * into v_item from items where id = r.item_id;
  if not is_manager_for(v_item.room_id) then raise exception 'Keine Berechtigung'; end if;
  if p_approve then
    if r.status <> 'active' then raise exception 'Die Ausleihe ist bereits beendet'; end if;
    begin
      update rentals set end_at = greatest(q.new_end_at, r.end_at) where id = r.id;
    exception when exclusion_violation then
      raise exception 'Der Artikel ist im beantragten Zeitraum bereits reserviert';
    end;
  end if;
  update extension_requests
     set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
   where id = q.id;
  insert into activity_log (actor_id, subject_id, action, item_id, item_name, details)
    values (auth.uid(), q.requested_by, 'VERLÄNGERUNG', r.item_id, v_item.name,
            jsonb_build_object('new_end', q.new_end_at, 'status', case when p_approve then 'genehmigt' else 'abgelehnt' end, 'note', nullif(trim(p_note), ''), 'rental_id', r.id));
  perform notify_user(q.requested_by,
    case when p_approve then 'Verlängerung genehmigt' else 'Verlängerung abgelehnt' end,
    v_item.name || case when p_approve then ' bis ' || to_char(q.new_end_at at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                        else '' || coalesce(' – ' || nullif(trim(p_note), ''), '') end,
    'rental', 'rental:' || r.id);
end $$;

create or replace function public.cancel_extension_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update extension_requests set status = 'cancelled'
   where id = p_request_id and requested_by = auth.uid() and status = 'pending';
  if not found then raise exception 'Antrag nicht gefunden oder bereits entschieden'; end if;
end $$;

-- ---------- Warteliste ----------
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (item_id, user_id)
);
alter table public.waitlist enable row level security;
drop policy if exists waitlist_own on public.waitlist;
create policy waitlist_own on public.waitlist for select to authenticated using (user_id = auth.uid());

create or replace function public.join_waitlist(p_item_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if not exists (select 1 from items where id = p_item_id) then raise exception 'Artikel nicht gefunden'; end if;
  insert into waitlist (item_id, user_id) values (p_item_id, auth.uid()) on conflict do nothing;
end $$;

create or replace function public.leave_waitlist(p_item_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from waitlist where item_id = p_item_id and user_id = auth.uid();
end $$;

-- Benachrichtigt Wartende, sobald der Artikel wirklich frei ist (einmalig, danach wird der Eintrag entfernt)
create or replace function public.notify_waitlist(p_item_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_item items; w record;
begin
  select * into v_item from items where id = p_item_id;
  if not found or v_item.status <> 'active' then return; end if;
  if exists (select 1 from rentals where item_id = p_item_id and status = 'active' and start_at <= now()) then return; end if;
  for w in select user_id from waitlist where item_id = p_item_id loop
    perform notify_user(w.user_id, 'Wieder verfügbar', v_item.name || ' ist jetzt verfügbar.', 'rental', 'item:' || p_item_id);
  end loop;
  delete from waitlist where item_id = p_item_id;
end $$;

create or replace function public.trg_waitlist_rental_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform notify_waitlist(new.item_id); return null; end $$;
create or replace function public.trg_waitlist_item_active() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform notify_waitlist(new.id); return null; end $$;
create or replace function public.trg_waitlist_clear() returns trigger
language plpgsql security definer set search_path = public as $$
begin delete from waitlist where item_id = new.item_id and user_id = new.borrower_id; return null; end $$;

drop trigger if exists rentals_waitlist_done on public.rentals;
create constraint trigger rentals_waitlist_done after update of status on public.rentals
  deferrable initially deferred for each row
  when (old.status = 'active' and new.status in ('returned', 'cancelled'))
  execute function public.trg_waitlist_rental_done();   -- läuft am Ende der Transaktion (nach evtl. Defekt-Meldung)

drop trigger if exists items_waitlist_active on public.items;
create trigger items_waitlist_active after update of status on public.items
  for each row when (old.status <> 'active' and new.status = 'active')
  execute function public.trg_waitlist_item_active();

drop trigger if exists rentals_waitlist_clear on public.rentals;
create trigger rentals_waitlist_clear after insert on public.rentals
  for each row execute function public.trg_waitlist_clear();

-- ---------- Sammel-Ausleihe (teilweise Erfolge möglich) ----------
create or replace function public.rent_items(p_item_ids text[], p_start timestamptz, p_end timestamptz,
                                             p_project text default null, p_borrower uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text; v_res jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if cardinality(p_item_ids) > 50 then raise exception 'Höchstens 50 Artikel auf einmal'; end if;
  foreach v_id in array p_item_ids loop
    begin
      perform rent_item(v_id, p_start, p_end, p_project, p_borrower);
      v_res := v_res || jsonb_build_array(jsonb_build_object('item_id', v_id, 'ok', true));
    exception when others then
      v_res := v_res || jsonb_build_array(jsonb_build_object('item_id', v_id, 'ok', false, 'error', sqlerrm));
    end;
  end loop;
  return v_res;
end $$;

-- ---------- Rechte ----------
revoke execute on function public.extend_rental(uuid, timestamptz, text) from public, anon;
revoke execute on function public.decide_extension(uuid, boolean, text) from public, anon;
revoke execute on function public.cancel_extension_request(uuid) from public, anon;
revoke execute on function public.join_waitlist(text) from public, anon;
revoke execute on function public.leave_waitlist(text) from public, anon;
revoke execute on function public.rent_items(text[], timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.extend_rental(uuid, timestamptz, text) to authenticated;
grant execute on function public.decide_extension(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_extension_request(uuid) to authenticated;
grant execute on function public.join_waitlist(text) to authenticated;
grant execute on function public.leave_waitlist(text) to authenticated;
grant execute on function public.rent_items(text[], timestamptz, timestamptz, text, uuid) to authenticated;
revoke execute on function public.notify_waitlist(text) from public, anon, authenticated;
revoke execute on function public.trg_waitlist_rental_done() from public, anon, authenticated;
revoke execute on function public.trg_waitlist_item_active() from public, anon, authenticated;
revoke execute on function public.trg_waitlist_clear() from public, anon, authenticated;
