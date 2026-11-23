-- =====================================================================
-- 007: Schadensfotos, Wartungs-/Prüfintervalle, Änderungsprotokoll für Artikel,
--      Inventur (Soll/Ist), abonnierbarer Kalender-Link
-- (nach 001–006 einmal ausführen, wiederholbar, löscht keine Daten)
-- =====================================================================

-- ---------- Schadensfotos bei der Rückgabe ----------
-- Jeder angemeldete Nutzer darf in seinen eigenen Ordner (<user-id>/...) hochladen.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('damage-photos', 'damage-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists damage_photos_select on storage.objects;
drop policy if exists damage_photos_insert on storage.objects;
drop policy if exists damage_photos_delete on storage.objects;
create policy damage_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'damage-photos');
create policy damage_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'damage-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy damage_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'damage-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

alter table public.rentals drop constraint if exists rentals_damage_photos_max5;
alter table public.rentals add constraint rentals_damage_photos_max5
  check (jsonb_typeof(damage_photos) = 'array' and jsonb_array_length(damage_photos) <= 5);

-- ---------- Wartungs- / Prüfintervalle (z. B. jährliche Prüfung von Elektrogeräten) ----------
alter table public.items add column if not exists inspection_interval_months int;
alter table public.items add column if not exists last_inspection_at timestamptz;
alter table public.items add column if not exists next_inspection_at timestamptz;
alter table public.items drop constraint if exists items_inspection_interval_chk;
alter table public.items add constraint items_inspection_interval_chk
  check (inspection_interval_months is null or inspection_interval_months between 1 and 120);
create index if not exists items_next_inspection_idx on public.items(next_inspection_at) where next_inspection_at is not null;

-- Nächste Prüfung = letzte Prüfung (oder Anlagedatum) + Intervall
create or replace function public.items_set_next_inspection() returns trigger language plpgsql as $$
begin
  if new.inspection_interval_months is null then
    new.next_inspection_at := null;
  else
    new.next_inspection_at := coalesce(new.last_inspection_at, new.created_at, now()) + make_interval(months => new.inspection_interval_months);
  end if;
  return new;
end $$;
drop trigger if exists items_next_inspection on public.items;
create trigger items_next_inspection before insert or update of inspection_interval_months, last_inspection_at on public.items
  for each row execute function public.items_set_next_inspection();

-- Prüfung eintragen (bestanden: neue Frist; nicht bestanden: Artikel geht in „Defekt / Wartung")
create or replace function public.record_inspection(p_item_id text, p_passed boolean default true, p_note text default null) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_item items; v_next timestamptz;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'Artikel nicht gefunden'; end if;
  if not is_manager_for(v_item.room_id) then raise exception 'Keine Berechtigung'; end if;
  update items set last_inspection_at = now(),
                   status = case when p_passed then status else 'maintenance' end
   where id = p_item_id returning next_inspection_at into v_next;
  insert into activity_log (actor_id, action, item_id, item_name, details)
    values (auth.uid(), 'PRÜFUNG', p_item_id, v_item.name,
            jsonb_build_object('result', case when p_passed then 'bestanden' else 'nicht bestanden' end,
                               'note', nullif(trim(p_note), ''), 'next', v_next));
  if not p_passed then
    perform notify_managers(v_item.room_id, 'Prüfung nicht bestanden',
      v_item.name || coalesce(': ' || nullif(trim(p_note), ''), ''), 'damage', 'item:' || v_item.id);
  end if;
  return v_next;
end $$;

-- ---------- Änderungsprotokoll für Artikel (Anlegen und Bearbeiten) ----------
-- Status-Änderungen werden bereits von den jeweiligen Funktionen protokolliert, Entnahmen als ENTNAHME.
create or replace function public.log_item_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_changes jsonb := '{}'; k text; o jsonb; n jsonb;
begin
  if coalesce(current_setting('lager.silent', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    insert into activity_log (actor_id, action, item_id, item_name, details)
      values (auth.uid(), 'ANGELEGT', new.id, new.name, jsonb_build_object('room', new.room_id));
    return null;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  foreach k in array array['name', 'room_id', 'category', 'item_type', 'shelf', 'compartment', 'accessories',
                           'stock_quantity', 'min_stock', 'required_permission', 'inspection_interval_months'] loop
    if (o -> k) is distinct from (n -> k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('alt', o -> k, 'neu', n -> k));
    end if;
  end loop;
  if jsonb_array_length(old.photos) <> jsonb_array_length(new.photos) then
    v_changes := v_changes || jsonb_build_object('photos', jsonb_build_object('alt', jsonb_array_length(old.photos), 'neu', jsonb_array_length(new.photos)));
  end if;
  if v_changes <> '{}'::jsonb then
    insert into activity_log (actor_id, action, item_id, item_name, details)
      values (auth.uid(), 'GEÄNDERT', new.id, new.name, jsonb_build_object('changes', v_changes));
  end if;
  return null;
end $$;
drop trigger if exists items_log_changes on public.items;
create trigger items_log_changes after insert or update on public.items
  for each row execute function public.log_item_changes();

-- Entnahme setzt den Bestand selbst und protokolliert als ENTNAHME (kein zusätzliches GEÄNDERT)
create or replace function public.consume_item(p_item_id text, p_qty int, p_reason text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_item items; v_new int;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_qty < 1 then raise exception 'Menge muss mindestens 1 sein'; end if;
  select * into v_item from items where id = p_item_id for update;
  if not found or v_item.item_type <> 'consumable' then raise exception 'Kein Verbrauchsmaterial'; end if;
  if v_item.stock_quantity < p_qty then raise exception 'Nur noch % Stück vorhanden', v_item.stock_quantity; end if;
  v_new := v_item.stock_quantity - p_qty;
  perform set_config('lager.silent', 'on', true);
  update items set stock_quantity = v_new where id = p_item_id;
  perform set_config('lager.silent', 'off', true);
  insert into activity_log (actor_id, subject_id, action, item_id, item_name, details)
    values (auth.uid(), auth.uid(), 'ENTNAHME', p_item_id, v_item.name, jsonb_build_object('qty', p_qty, 'remaining', v_new, 'reason', p_reason));
  if v_new <= v_item.min_stock then
    perform notify_managers(v_item.room_id, 'Nachbestellen', v_item.name || ': nur noch ' || v_new || ' Stück', 'stock', 'item:' || p_item_id);
  end if;
  return v_new;
end $$;

-- Katalog-Sicht neu (enthält jetzt die Prüffelder und „Prüfung fällig" = innerhalb von 14 Tagen oder überfällig)
drop view if exists public.catalog_items;
create view public.catalog_items as
select i.*,
  exists (select 1 from public.rentals r where r.item_id = i.id and r.status = 'active' and r.start_at <= now()) as rented_now,
  (select max(r.end_at) from public.rentals r where r.item_id = i.id and r.status = 'active' and r.start_at <= now()) as rented_until,
  (i.item_type = 'consumable' and i.stock_quantity <= i.min_stock) as low_stock,
  (i.next_inspection_at is not null and i.next_inspection_at <= now() + interval '14 days') as inspection_due
from public.items i;
revoke all on public.catalog_items from anon;
grant select on public.catalog_items to authenticated;

-- Erinnerungen: zusätzlich Prüfungen (7 Tage vorher, einmal pro Fälligkeitstermin an die Verantwortlichen)
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
  -- 2) Überfällig (höchstens einmal pro 24 Stunden)
  for x in select r.id, r.borrower_id, r.end_at, i.name from rentals r join items i on i.id = r.item_id
           where r.status = 'active' and r.end_at < now()
             and not exists (select 1 from notifications n where n.link = 'rental:' || r.id and n.type = 'overdue' and n.created_at > now() - interval '24 hours') loop
    perform notify_user(x.borrower_id, 'Überfällig', x.name || ' war fällig am ' || to_char(x.end_at at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'), 'overdue', 'rental:' || x.id);
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

-- ---------- Inventur: Raum scannen, Soll/Ist vergleichen ----------
create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  counted_by uuid references public.profiles(id) on delete set null,
  expected int not null,
  found int not null,
  missing jsonb not null default '[]',
  unexpected jsonb not null default '[]',
  unknown jsonb not null default '[]',
  rented jsonb not null default '[]',
  marked_missing boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_counts_room_idx on public.inventory_counts(room_id, created_at desc);
alter table public.inventory_counts enable row level security;
drop policy if exists inventory_read on public.inventory_counts;
create policy inventory_read on public.inventory_counts for select to authenticated using (is_manager_for(room_id));

-- Speichert eine Zählung. Die Differenz wird serverseitig berechnet (maßgeblich ist der Datenbankstand).
create or replace function public.save_inventory(p_room text, p_scanned text[], p_note text default null, p_mark_missing boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_scanned text[]; v_room rooms; v_id uuid;
  v_expected int; v_found int; v_missing jsonb; v_unexpected jsonb; v_unknown jsonb; v_rented jsonb;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into v_room from rooms where id = p_room;
  if not found then raise exception 'Raum nicht gefunden'; end if;
  if not is_manager_for(p_room) then raise exception 'Keine Berechtigung für diesen Raum'; end if;
  select coalesce(array_agg(distinct s), '{}') into v_scanned
    from (select nullif(trim(x), '') as s from unnest(coalesce(p_scanned, '{}')) x) t where s is not null;
  if cardinality(v_scanned) > 5000 then raise exception 'Höchstens 5000 Codes pro Inventur'; end if;

  with room_items as (
    select i.id, i.name, i.status,
           exists (select 1 from rentals r where r.item_id = i.id and r.status = 'active' and r.start_at <= now()) as out_now
      from items i where i.room_id = p_room)
  select count(*) filter (where id = any(v_scanned) or not out_now),
         count(*) filter (where id = any(v_scanned)),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status) order by name)
                  filter (where not id = any(v_scanned) and not out_now), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
                  filter (where not id = any(v_scanned) and out_now), '[]')
    into v_expected, v_found, v_missing, v_rented
    from room_items;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'room', i.room_id) order by i.name), '[]') into v_unexpected
    from items i where i.id = any(v_scanned) and i.room_id <> p_room;
  select coalesce(jsonb_agg(to_jsonb(s) order by s), '[]') into v_unknown
    from unnest(v_scanned) s where not exists (select 1 from items i where i.id = s);

  if p_mark_missing and jsonb_array_length(v_missing) > 0 then
    update items set status = 'inventory'
     where id in (select m ->> 'id' from jsonb_array_elements(v_missing) m) and status = 'active';
  end if;

  insert into inventory_counts (room_id, counted_by, expected, found, missing, unexpected, unknown, rented, marked_missing, note)
    values (p_room, auth.uid(), v_expected, v_found, v_missing, v_unexpected, v_unknown, v_rented, coalesce(p_mark_missing, false), nullif(trim(p_note), ''))
    returning id into v_id;
  insert into activity_log (actor_id, action, item_id, item_name, details)
    values (auth.uid(), 'INVENTUR', null, 'Raum ' || v_room.name,
            jsonb_build_object('room', p_room, 'expected', v_expected, 'found', v_found,
                               'missing', jsonb_array_length(v_missing), 'unexpected', jsonb_array_length(v_unexpected) + jsonb_array_length(v_unknown),
                               'marked', coalesce(p_mark_missing, false), 'note', nullif(trim(p_note), ''), 'inventory_id', v_id));
  return jsonb_build_object('id', v_id, 'expected', v_expected, 'found', v_found, 'missing', v_missing,
                            'unexpected', v_unexpected, 'unknown', v_unknown, 'rented', v_rented);
end $$;

-- ---------- Abonnierbarer Kalender-Link (Google/Outlook/Apple) ----------
create table if not exists public.calendar_feeds (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
drop policy if exists calendar_feeds_own on public.calendar_feeds;
create policy calendar_feeds_own on public.calendar_feeds for select to authenticated using (user_id = auth.uid());

-- Liefert den persönlichen Geheim-Schlüssel des Links (p_reset = alten Link ungültig machen)
create or replace function public.calendar_feed_token(p_reset boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_reset then delete from calendar_feeds where user_id = auth.uid(); end if;
  insert into calendar_feeds (user_id, token)
    values (auth.uid(), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    on conflict (user_id) do nothing;
  select token into v_token from calendar_feeds where user_id = auth.uid();
  return v_token;
end $$;

-- Nur für die Edge Function „calendar-feed" (service_role): eigene Ausleihen + Buchungen in verantworteten Räumen
create or replace function public.calendar_feed_events(p_token text)
returns table (id uuid, item_id text, item_name text, room_id text, start_at timestamptz, end_at timestamptz,
               status text, returned_at timestamptz, borrower_name text, project text, own boolean)
language sql stable security definer set search_path = public as $$
  with me as (select p.id, p.role, p.managed_room from calendar_feeds f join profiles p on p.id = f.user_id
              where f.token = p_token and length(p_token) >= 32)
  select r.id, r.item_id, i.name, i.room_id, r.start_at, r.end_at, r.status, r.returned_at,
         nullif(b.full_name, ''), r.project, r.borrower_id = me.id
    from rentals r
    join items i on i.id = r.item_id
    join profiles b on b.id = r.borrower_id
    cross join me
   where r.status in ('active', 'returned')
     and r.end_at > now() - interval '90 days'
     and (r.borrower_id = me.id
          or me.role = 'admin'
          or (me.role = 'raum_manager' and (me.managed_room is null or me.managed_room = i.room_id)))
   order by r.start_at
   limit 2000
$$;

-- ---------- Rechte ----------
revoke execute on function public.record_inspection(text, boolean, text) from public, anon;
revoke execute on function public.save_inventory(text, text[], text, boolean) from public, anon;
revoke execute on function public.calendar_feed_token(boolean) from public, anon;
grant execute on function public.record_inspection(text, boolean, text) to authenticated;
grant execute on function public.save_inventory(text, text[], text, boolean) to authenticated;
grant execute on function public.calendar_feed_token(boolean) to authenticated;
revoke execute on function public.consume_item(text, int, text) from public, anon;
grant execute on function public.consume_item(text, int, text) to authenticated;
revoke execute on function public.run_reminders() from public, anon, authenticated;
revoke execute on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to service_role;
revoke execute on function public.log_item_changes() from public, anon, authenticated;
revoke execute on function public.items_set_next_inspection() from public, anon, authenticated;
