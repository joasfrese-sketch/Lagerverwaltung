-- =====================================================================
-- Lagerverwaltung Pro – Neuaufbau (001_schema.sql)
-- ACHTUNG: DESTRUKTIV. Löscht alle alten Tabellen im Schema public.
-- Ausführen im Supabase SQL Editor. Nutzerkonten (auth.users) bleiben,
-- Profile werden unten für bestehende Konten neu angelegt.
-- =====================================================================
create extension if not exists btree_gist;

drop view  if exists public.rental_calendar, public.public_profiles cascade;
drop table if exists public.app_notifications, public.notifications, public.waitlist,
  public.permissions, public.loans, public.chat_messages, public.chat_members, public.chats,
  public.messages, public.activity_log, public.rentals, public.items, public.rooms,
  public.user_settings, public.profiles cascade;
drop sequence if exists public.item_seq;

-- ---------- Tabellen ----------
create table public.rooms (
  id text primary key,
  name text not null,
  icon text default '📦',
  description text,
  field_definitions jsonb not null default '[]',
  sort_order int not null default 0
);
insert into public.rooms (id, name, icon, description, sort_order) values
  ('Bibliothek','Bibliothek','📚','Bücher, Dokumente & Medien',1),
  ('Freizeitheimlager','Freizeitheimlager','🏠','Spiele, Zeltmaterial & Freizeit',2),
  ('Küche','Küche','🍳','Küchengeräte, Geschirr & Verpflegung',3),
  ('Technik','Technik','🔌','Kameras, Licht, Ton & Kabel',4),
  ('Büro','Büro','🏢','Büromaterial, Drucker & Papier',5);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name text not null default '',
  role text not null default 'user' check (role in ('user','raum_manager','admin')),
  managed_room text references public.rooms(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  prefs jsonb not null default '{"notify_overdue":true,"notify_rental":true,"notify_chat":true}'
);

create sequence public.item_seq start 1001;
create table public.items (
  id text primary key default ('ART-' || nextval('public.item_seq')),
  name text not null,
  room_id text not null references public.rooms(id),
  category text,
  item_type text not null default 'standard' check (item_type in ('standard','kit','consumable')),
  status text not null default 'active' check (status in ('active','maintenance','inventory')),
  shelf text,
  compartment text,
  accessories text[] not null default '{}',
  photos jsonb not null default '[]',
  stock_quantity int not null default 1 check (stock_quantity >= 0),
  min_stock int not null default 0,
  required_permission text,
  custom_attributes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_room_idx on public.items(room_id);

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id) on delete cascade,
  borrower_id uuid not null references public.profiles(id),
  handed_out_by uuid references public.profiles(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  project text,
  status text not null default 'active' check (status in ('active','returned','cancelled')),
  returned_at timestamptz,
  returned_by uuid references public.profiles(id),
  return_note text,
  damage_report text,
  damage_photos jsonb not null default '[]',
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  -- Doppelbuchungen sind auf Datenbankebene unmöglich:
  constraint rentals_no_overlap exclude using gist (
    item_id with =, tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'active')
);
create index rentals_borrower_idx on public.rentals(borrower_id, status);

create table public.permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_name text not null,
  primary key (user_id, permission_name)
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('global','group','direct')),
  name text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
insert into public.chats (id, type, name) values ('00000000-0000-0000-0000-0000000000c1','global','Alle');

create table public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index chat_messages_chat_idx on public.chat_messages(chat_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  type text not null default 'info' check (type in ('info','overdue','rental','return','damage','stock','chat')),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  subject_id uuid references public.profiles(id),
  action text not null,
  item_id text,
  item_name text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_subject_idx on public.activity_log(subject_id, created_at desc);

-- ---------- Hilfsfunktionen (Rollen) ----------
create function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create function public.is_manager_for(p_room text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid()
     and (role = 'admin' or (role = 'raum_manager' and (managed_room is null or managed_room = p_room)))) $$;

create function public.is_manager_or_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role in ('admin','raum_manager')) $$;

create function public.is_chat_member(p_chat uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from chats c where c.id = p_chat and (c.type = 'global'
     or exists (select 1 from chat_members m where m.chat_id = c.id and m.user_id = auth.uid()))) $$;

-- ---------- Trigger ----------
create function public.touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();

-- Neue Auth-Konten bekommen automatisch Profil (Rolle immer 'user'; Client-Metadaten werden für die Rolle ignoriert)
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_user text;
begin
  v_user := lower(coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1)));
  v_user := regexp_replace(v_user, '[^a-z0-9._-]', '', 'g');
  if length(v_user) < 3 then v_user := v_user || 'user'; end if;
  v_user := left(v_user, 24);
  while exists (select 1 from profiles where username = v_user) loop
    v_user := left(v_user, 24) || floor(random()*900 + 100)::int;
  end loop;
  insert into profiles (id, email, username, full_name)
    values (new.id, lower(new.email), v_user, coalesce(new.raw_user_meta_data->>'full_name',''));
  insert into user_settings (user_id) values (new.id);
  insert into chat_members (chat_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Rolle/Raum/E-Mail darf nur ein Admin ändern (SQL Editor/service_role: auth.uid() is null -> erlaubt)
create function public.protect_profile_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() and
     (new.role is distinct from old.role or new.managed_room is distinct from old.managed_room
      or new.email is distinct from old.email or new.id is distinct from old.id) then
    raise exception 'Keine Berechtigung, Rolle, Raum oder E-Mail zu ändern';
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile_columns();

-- Profile für bereits vorhandene Auth-Konten nachziehen
insert into public.profiles (id, email, username, full_name)
select u.id, lower(u.email),
       regexp_replace(lower(split_part(u.email,'@',1)) || substr(u.id::text,1,4), '[^a-z0-9._-]','','g'),
       coalesce(u.raw_user_meta_data->>'full_name','')
from auth.users u on conflict do nothing;
insert into public.user_settings (user_id) select id from public.profiles on conflict do nothing;
insert into public.chat_members (chat_id, user_id) select '00000000-0000-0000-0000-0000000000c1', id from public.profiles on conflict do nothing;

-- ---------- Views ----------
create view public.public_profiles as
  select id, username, full_name, role, managed_room from public.profiles;

-- Belegungsplan: Fremde sehen nur "belegt", Verantwortliche und Betroffene sehen Details
create view public.rental_calendar as
select r.id, r.item_id, i.name as item_name, i.room_id, r.start_at, r.end_at, r.status, r.returned_at,
       (r.status = 'active' and r.end_at < now()) as overdue,
       case when r.borrower_id = auth.uid() or public.is_manager_for(i.room_id) then r.borrower_id end as borrower_id,
       case when r.borrower_id = auth.uid() or public.is_manager_for(i.room_id) then p.full_name end as borrower_name,
       case when r.borrower_id = auth.uid() or public.is_manager_for(i.room_id) then r.project end as project
from public.rentals r
join public.items i on i.id = r.item_id
join public.profiles p on p.id = r.borrower_id;

-- ---------- Interne Helfer (nicht vom Client aufrufbar) ----------
create function public.notify_user(p_user uuid, p_title text, p_body text, p_type text, p_link text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_prefs jsonb;
begin
  select prefs into v_prefs from user_settings where user_id = p_user;
  if p_type = 'overdue' and coalesce((v_prefs->>'notify_overdue')::boolean, true) = false then return; end if;
  if p_type in ('rental','return') and coalesce((v_prefs->>'notify_rental')::boolean, true) = false then return; end if;
  insert into notifications (user_id, title, body, type, link) values (p_user, p_title, p_body, p_type, p_link);
end $$;

create function public.notify_managers(p_room text, p_title text, p_body text, p_type text, p_link text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from profiles where role = 'admin' or (role = 'raum_manager' and (managed_room is null or managed_room = p_room)) loop
    perform notify_user(r.id, p_title, p_body, p_type, p_link);
  end loop;
end $$;

-- ---------- Anmeldung per Benutzername ----------
create function public.email_for_username(p_username text) returns text
language sql stable security definer set search_path = public as
$$ select email from profiles where username = lower(trim(p_username)) $$;

-- ---------- Ausleihe ----------
create function public.rent_item(p_item_id text, p_start timestamptz, p_end timestamptz,
                                 p_project text default null, p_borrower uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_borrower uuid := coalesce(p_borrower, auth.uid()); v_item items; v_id uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into v_item from items where id = p_item_id;
  if not found then raise exception 'Artikel nicht gefunden'; end if;
  if v_item.item_type = 'consumable' then raise exception 'Verbrauchsmaterial wird entnommen, nicht ausgeliehen'; end if;
  if v_item.status <> 'active' then raise exception 'Artikel ist aktuell nicht ausleihbar (%)', v_item.status; end if;
  if p_end <= p_start then raise exception 'Die Rückgabe muss nach dem Beginn liegen'; end if;
  if v_borrower <> auth.uid() and not is_manager_for(v_item.room_id) then
    raise exception 'Nur Raum-Manager/Admins dürfen für andere Personen ausleihen';
  end if;
  if v_item.required_permission is not null and not is_manager_for(v_item.room_id)
     and not exists (select 1 from permissions where user_id = v_borrower and permission_name = v_item.required_permission) then
    raise exception 'Für diesen Artikel fehlt die Berechtigung "%"', v_item.required_permission;
  end if;
  begin
    insert into rentals (item_id, borrower_id, handed_out_by, start_at, end_at, project)
      values (p_item_id, v_borrower, auth.uid(), p_start, p_end, nullif(trim(p_project),''))
      returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Der Artikel ist im gewählten Zeitraum bereits belegt';
  end;
  select full_name into v_name from profiles where id = v_borrower;
  insert into activity_log (actor_id, subject_id, action, item_id, item_name, details)
    values (auth.uid(), v_borrower, 'AUSLEIHE', p_item_id, v_item.name,
            jsonb_build_object('project', p_project, 'start', p_start, 'end', p_end, 'rental_id', v_id));
  perform notify_user(v_borrower, 'Ausleihe bestätigt', v_item.name || ' bis ' || to_char(p_end at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'), 'rental', 'rental:' || v_id);
  return v_id;
end $$;

-- Rückgabe (einzeln oder Sammel-Abgabe). p_returned_by = abgebende Person (Drittperson möglich)
create function public.return_rentals(p_rental_ids uuid[], p_returned_by uuid default null,
                                      p_note text default null, p_damage text default null,
                                      p_damage_photos jsonb default '[]')
returns int language plpgsql security definer set search_path = public as $$
declare r rentals; v_item items; v_count int := 0;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  for r in select * from rentals where id = any(p_rental_ids) and status = 'active' for update loop
    select * into v_item from items where id = r.item_id;
    if r.borrower_id <> auth.uid() and not is_manager_for(v_item.room_id) then
      raise exception 'Keine Berechtigung für die Rückgabe von %', v_item.name;
    end if;
    update rentals set status = 'returned', returned_at = now(), returned_by = coalesce(p_returned_by, auth.uid()),
           return_note = nullif(trim(p_note),''), damage_report = nullif(trim(p_damage),''),
           damage_photos = coalesce(p_damage_photos,'[]') where id = r.id;
    if nullif(trim(p_damage),'') is not null then
      update items set status = 'maintenance' where id = r.item_id;
      perform notify_managers(v_item.room_id, 'Defekt gemeldet', v_item.name || ': ' || p_damage, 'damage', 'item:' || v_item.id);
    end if;
    insert into activity_log (actor_id, subject_id, action, item_id, item_name, details)
      values (auth.uid(), r.borrower_id, case when nullif(trim(p_damage),'') is not null then 'DEFEKT' else 'RÜCKGABE' end,
              r.item_id, v_item.name, jsonb_build_object('note', p_note, 'damage', p_damage, 'returned_by', coalesce(p_returned_by, auth.uid()), 'rental_id', r.id));
    perform notify_user(r.borrower_id, 'Rückgabe verbucht', v_item.name, 'return', 'rental:' || r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.set_item_status(p_item_id text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_room text; v_name text;
begin
  select room_id, name into v_room, v_name from items where id = p_item_id;
  if not found then raise exception 'Artikel nicht gefunden'; end if;
  if not is_manager_for(v_room) then raise exception 'Keine Berechtigung'; end if;
  if p_status not in ('active','maintenance','inventory') then raise exception 'Ungültiger Status'; end if;
  update items set status = p_status where id = p_item_id;
  insert into activity_log (actor_id, action, item_id, item_name, details)
    values (auth.uid(), 'STATUS', p_item_id, v_name, jsonb_build_object('status', p_status));
end $$;

create function public.consume_item(p_item_id text, p_qty int, p_reason text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_item items; v_new int;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_qty < 1 then raise exception 'Menge muss mindestens 1 sein'; end if;
  select * into v_item from items where id = p_item_id for update;
  if not found or v_item.item_type <> 'consumable' then raise exception 'Kein Verbrauchsmaterial'; end if;
  if v_item.stock_quantity < p_qty then raise exception 'Nur noch % Stück vorhanden', v_item.stock_quantity; end if;
  v_new := v_item.stock_quantity - p_qty;
  update items set stock_quantity = v_new where id = p_item_id;
  insert into activity_log (actor_id, subject_id, action, item_id, item_name, details)
    values (auth.uid(), auth.uid(), 'ENTNAHME', p_item_id, v_item.name, jsonb_build_object('qty', p_qty, 'remaining', v_new, 'reason', p_reason));
  if v_new <= v_item.min_stock then
    perform notify_managers(v_item.room_id, 'Nachbestellen', v_item.name || ': nur noch ' || v_new || ' Stück', 'stock', 'item:' || p_item_id);
  end if;
  return v_new;
end $$;

-- ---------- Chat ----------
create function public.get_or_create_direct_chat(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_other = auth.uid() then raise exception 'Ungültiger Chat'; end if;
  select c.id into v_id from chats c
   where c.type = 'direct'
     and exists (select 1 from chat_members where chat_id = c.id and user_id = auth.uid())
     and exists (select 1 from chat_members where chat_id = c.id and user_id = p_other) limit 1;
  if v_id is null then
    insert into chats (type, created_by) values ('direct', auth.uid()) returning id into v_id;
    insert into chat_members (chat_id, user_id) values (v_id, auth.uid()), (v_id, p_other);
  end if;
  return v_id;
end $$;

create function public.create_group_chat(p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into chats (type, name, created_by) values ('group', trim(p_name), auth.uid()) returning id into v_id;
  insert into chat_members (chat_id, user_id)
    select v_id, x from unnest(p_members || auth.uid()) as x group by x;
  return v_id;
end $$;

-- ---------- Überfällig-Erinnerungen (per pg_cron stündlich aufrufen) ----------
create function public.mark_overdue_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare x record; v_count int := 0;
begin
  for x in select r.id, r.borrower_id, r.end_at, i.name from rentals r join items i on i.id = r.item_id
           where r.status = 'active' and r.end_at < now()
             and not exists (select 1 from notifications n where n.link = 'rental:' || r.id and n.type = 'overdue' and n.created_at > now() - interval '24 hours') loop
    perform notify_user(x.borrower_id, 'Überfällig', x.name || ' war fällig am ' || to_char(x.end_at at time zone 'Europe/Berlin','DD.MM.YYYY HH24:MI'), 'overdue', 'rental:' || x.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
-- select cron.schedule('overdue-check', '0 * * * *', 'select public.mark_overdue_notifications()');

-- ---------- Row Level Security ----------
alter table public.rooms enable row level security;
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.items enable row level security;
alter table public.rentals enable row level security;
alter table public.permissions enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_log enable row level security;

create policy rooms_read   on public.rooms for select to authenticated using (true);
create policy rooms_admin  on public.rooms for all to authenticated using (is_admin()) with check (is_admin());

create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or is_manager_or_admin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());

create policy settings_own on public.user_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy items_read   on public.items for select to authenticated using (true);
create policy items_write  on public.items for insert to authenticated with check (is_manager_for(room_id));
create policy items_update on public.items for update to authenticated using (is_manager_for(room_id)) with check (is_manager_for(room_id));
create policy items_delete on public.items for delete to authenticated using (is_manager_for(room_id));

-- Rentals: nur lesen (eigene bzw. verantwortete Räume). Schreiben ausschließlich über rent_item / return_rentals.
create policy rentals_read on public.rentals for select to authenticated using (
  borrower_id = auth.uid() or exists (select 1 from items i where i.id = rentals.item_id and is_manager_for(i.room_id)));

create policy permissions_read  on public.permissions for select to authenticated using (user_id = auth.uid() or is_manager_or_admin());
create policy permissions_write on public.permissions for all to authenticated using (is_manager_or_admin()) with check (is_manager_or_admin());

create policy chats_read on public.chats for select to authenticated using (is_chat_member(id));
create policy members_read on public.chat_members for select to authenticated using (user_id = auth.uid() or is_chat_member(chat_id));
create policy members_self on public.chat_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy msgs_read on public.chat_messages for select to authenticated using (is_chat_member(chat_id));
create policy msgs_insert on public.chat_messages for insert to authenticated with check (sender_id = auth.uid() and is_chat_member(chat_id));

create policy notif_read   on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy activity_read on public.activity_log for select to authenticated using (
  actor_id = auth.uid() or subject_id = auth.uid() or is_manager_or_admin());

-- ---------- Rechte ----------
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.email_for_username(text) to anon, authenticated;
revoke execute on function public.notify_user(uuid,text,text,text,text) from authenticated;
revoke execute on function public.notify_managers(text,text,text,text,text) from authenticated;
revoke execute on function public.mark_overdue_notifications() from authenticated;
grant select on public.public_profiles, public.rental_calendar to authenticated;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.rentals, public.items, public.chat_messages, public.notifications;

-- ---------- Ersten Admin festlegen (nach der Registrierung einmalig ausführen) ----------
-- update public.profiles set role = 'admin' where email = 'joas.frese@gmail.com';
