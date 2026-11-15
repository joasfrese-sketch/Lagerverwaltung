-- =====================================================================
-- 009: WhatsApp-Anbindung (offizielle Cloud API)
-- App-Chats können mit WhatsApp-Rufnummern verbunden werden (Einzelperson oder Verteiler/„Gruppe“).
-- Nachrichten laufen in beide Richtungen. Der Versand an Meta passiert in den Edge Functions
-- „whatsapp-send“ / „whatsapp-webhook“; die Auslösung per Trigger steht in supabase/setup/009_whatsapp_trigger.sql.
-- (nach 001–008 einmal ausführen, wiederholbar, löscht keine Daten)
-- =====================================================================

-- ---------- Rufnummern normalisieren (Ziffern mit Ländervorwahl) ----------
create or replace function public.wa_normalize_phone(p_input text) returns text
language plpgsql immutable as $$
declare s text := regexp_replace(coalesce(p_input, ''), '[\s().\-/]', '', 'g');
begin
  if s = '' then raise exception 'Bitte eine Rufnummer eingeben.'; end if;
  if left(s, 1) = '+' then s := substr(s, 2);
  elsif left(s, 2) = '00' then s := substr(s, 3);
  elsif left(s, 1) = '0' then raise exception 'Bitte mit Ländervorwahl eingeben, z. B. +49 151 23456789 (statt 0151 …).';
  end if;
  if s !~ '^[0-9]+$' then raise exception 'Die Rufnummer darf nur Ziffern enthalten.'; end if;
  if length(s) < 8 or length(s) > 15 then raise exception 'Die Rufnummer hat eine ungültige Länge.'; end if;
  return s;
end $$;

-- ---------- Chat-Nachrichten: auch Absender ohne App-Konto (WhatsApp) ----------
alter table public.chat_messages alter column sender_id drop not null;
alter table public.chat_messages add column if not exists source text not null default 'app';
alter table public.chat_messages add column if not exists wa_name text;
alter table public.chat_messages add column if not exists wa_phone text;
alter table public.chat_messages add column if not exists wa_message_id text;
alter table public.chat_messages drop constraint if exists chat_messages_source_chk;
alter table public.chat_messages add constraint chat_messages_source_chk
  check (source in ('app', 'whatsapp') and (sender_id is not null or source = 'whatsapp'));
create unique index if not exists chat_messages_wa_unique on public.chat_messages(chat_id, wa_message_id) where wa_message_id is not null;

-- ---------- Verbundene Rufnummern pro Chat ----------
create table if not exists public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  name text not null default '',
  last_inbound_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (chat_id, phone)
);
create index if not exists whatsapp_contacts_phone_idx on public.whatsapp_contacts(phone);
alter table public.whatsapp_contacts enable row level security;
drop policy if exists wa_contacts_admin on public.whatsapp_contacts;
create policy wa_contacts_admin on public.whatsapp_contacts for select to authenticated using (is_admin());

-- Zustellstatus je Nachricht und Rufnummer (für Chat-Mitglieder sichtbar, ohne Rufnummern)
create table if not exists public.whatsapp_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_contacts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  wa_message_id text,
  created_at timestamptz not null default now(),
  unique (message_id, contact_id)
);
create index if not exists whatsapp_deliveries_chat_idx on public.whatsapp_deliveries(chat_id, created_at desc);
alter table public.whatsapp_deliveries enable row level security;
drop policy if exists wa_deliveries_read on public.whatsapp_deliveries;
create policy wa_deliveries_read on public.whatsapp_deliveries for select to authenticated using (is_chat_member(chat_id));

-- ---------- Chat-Benachrichtigung: auch für Nachrichten ohne App-Absender ----------
create or replace function public.on_chat_message() returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text; v_name text; v_sender text; m record;
begin
  select type, name into v_type, v_name from chats where id = new.chat_id;
  if v_type = 'global' then return new; end if;
  if new.sender_id is not null then select full_name into v_sender from profiles where id = new.sender_id;
  else v_sender := coalesce(nullif(new.wa_name, ''), '+' || new.wa_phone) || ' (WhatsApp)'; end if;
  for m in select user_id from chat_members where chat_id = new.chat_id and user_id is distinct from new.sender_id loop
    if not exists (select 1 from notifications where user_id = m.user_id and link = 'chat:' || new.chat_id and read_at is null) then
      perform notify_user(m.user_id,
        coalesce(nullif(v_sender,''),'Neue Nachricht') || case when v_type = 'group' then ' in ' || coalesce(v_name,'Gruppe') else '' end,
        left(new.body, 140), 'chat', 'chat:' || new.chat_id);
    end if;
  end loop;
  return new;
end $$;

-- ---------- Verwaltung (nur Administratoren) ----------
create or replace function public.whatsapp_add_contact(p_chat uuid, p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_phone text := wa_normalize_phone(p_phone); v_id uuid; v_chat chats;
begin
  if not is_admin() then raise exception 'Nur Administratoren'; end if;
  select * into v_chat from chats where id = p_chat;
  if not found then raise exception 'Chat nicht gefunden'; end if;
  if (select count(*) from whatsapp_contacts where chat_id = p_chat) >= 50 then raise exception 'Höchstens 50 Rufnummern pro Chat'; end if;
  insert into whatsapp_contacts (chat_id, phone, name, created_by) values (p_chat, v_phone, left(trim(coalesce(p_name, '')), 80), auth.uid())
    on conflict (chat_id, phone) do update set name = excluded.name returning id into v_id;
  insert into activity_log (actor_id, action, item_name, details)
    values (auth.uid(), 'WHATSAPP', coalesce(v_chat.name, 'Chat'), jsonb_build_object('note', 'Rufnummer verbunden: ' || trim(coalesce(p_name, '')) || ' (+' || left(v_phone, 4) || '…)', 'chat_id', p_chat));
  return v_id;
end $$;

create or replace function public.whatsapp_remove_contact(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c whatsapp_contacts;
begin
  if not is_admin() then raise exception 'Nur Administratoren'; end if;
  delete from whatsapp_contacts where id = p_id returning * into c;
  if not found then raise exception 'Rufnummer nicht gefunden'; end if;
  insert into activity_log (actor_id, action, item_name, details)
    values (auth.uid(), 'WHATSAPP', 'Chat', jsonb_build_object('note', 'Rufnummer getrennt: ' || c.name || ' (+' || left(c.phone, 4) || '…)', 'chat_id', c.chat_id));
end $$;

-- Neuer App-Chat nur für WhatsApp (alle Administratoren sind Mitglied, damit Antworten niemand verpasst)
create or replace function public.whatsapp_create_chat(p_name text, p_contact_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then raise exception 'Nur Administratoren'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Bitte einen Chat-Namen angeben.'; end if;
  insert into chats (type, name, created_by) values ('group', trim(p_name), auth.uid()) returning id into v_id;
  insert into chat_members (chat_id, user_id) select v_id, id from profiles where role = 'admin' or id = auth.uid() on conflict do nothing;
  perform whatsapp_add_contact(v_id, p_contact_name, p_phone);
  return v_id;
end $$;

-- Welche Chats sind verbunden? (für alle Mitglieder; ohne Rufnummern)
create or replace function public.whatsapp_bridged_chats() returns table (chat_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select c.chat_id, count(*)::int from whatsapp_contacts c where is_chat_member(c.chat_id) group by c.chat_id
$$;

-- ---------- Nur für die Edge Functions (service_role) ----------
-- Eingehende Nachricht: in jeden verbundenen Chat dieser Rufnummer einfügen (doppelte Zustellung wird ignoriert)
create or replace function public.whatsapp_ingest(p_phone text, p_name text, p_body text, p_wa_id text) returns int
language plpgsql security definer set search_path = public as $$
declare c record; v_n int := 0; v_phone text;
begin
  begin v_phone := wa_normalize_phone('+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'));
  exception when others then return 0; end;
  for c in select id, chat_id, name from whatsapp_contacts where phone = v_phone loop
    insert into chat_messages (chat_id, sender_id, body, source, wa_name, wa_phone, wa_message_id)
      values (c.chat_id, null, left(coalesce(p_body, ''), 4000), 'whatsapp', coalesce(nullif(c.name, ''), nullif(trim(p_name), ''), '+' || v_phone), v_phone, p_wa_id)
      on conflict (chat_id, wa_message_id) where wa_message_id is not null do nothing;
    if found then v_n := v_n + 1; end if;
    update whatsapp_contacts set last_inbound_at = now(),
      name = case when name = '' and coalesce(trim(p_name), '') <> '' then left(trim(p_name), 80) else name end where id = c.id;
  end loop;
  return v_n;
end $$;

-- Ausgehend: reserviert (atomar, einmalig) die Zustellungen einer frischen Nachricht und liefert, was zu senden ist.
-- Der Absender selbst (bei WhatsApp-Nachrichten) bekommt seine eigene Nachricht nicht zurück.
create or replace function public.whatsapp_outbound(p_message_id uuid)
returns table (delivery_id uuid, phone text, contact_name text, in_window boolean, sender_label text, body text)
language plpgsql security definer set search_path = public as $$
declare m chat_messages; v_label text;
begin
  select * into m from chat_messages where id = p_message_id and created_at > now() - interval '10 minutes';
  if not found then return; end if;
  if m.sender_id is not null then select coalesce(nullif(trim(full_name), ''), username) into v_label from profiles where id = m.sender_id;
  else v_label := coalesce(nullif(m.wa_name, ''), '+' || m.wa_phone); end if;
  return query
    with ins as (
      insert into whatsapp_deliveries (message_id, chat_id, contact_id)
        select m.id, m.chat_id, c.id from whatsapp_contacts c where c.chat_id = m.chat_id and c.phone is distinct from m.wa_phone
        on conflict (message_id, contact_id) do nothing
        returning id, contact_id)
    select ins.id, c.phone, c.name, coalesce(c.last_inbound_at > now() - interval '23 hours 30 minutes', false), v_label, m.body
      from ins join whatsapp_contacts c on c.id = ins.contact_id;
end $$;

create or replace function public.whatsapp_set_delivery(p_id uuid, p_status text, p_error text default null, p_wa_id text default null) returns void
language sql security definer set search_path = public as $$
  update whatsapp_deliveries set status = p_status, error = left(p_error, 500), wa_message_id = p_wa_id
   where id = p_id and p_status in ('sent', 'failed')
$$;

-- ---------- Rechte ----------
revoke execute on function public.wa_normalize_phone(text) from public, anon;
revoke execute on function public.whatsapp_add_contact(uuid, text, text) from public, anon;
revoke execute on function public.whatsapp_remove_contact(uuid) from public, anon;
revoke execute on function public.whatsapp_create_chat(text, text, text) from public, anon;
revoke execute on function public.whatsapp_bridged_chats() from public, anon;
grant execute on function public.wa_normalize_phone(text) to authenticated;
grant execute on function public.whatsapp_add_contact(uuid, text, text) to authenticated;
grant execute on function public.whatsapp_remove_contact(uuid) to authenticated;
grant execute on function public.whatsapp_create_chat(text, text, text) to authenticated;
grant execute on function public.whatsapp_bridged_chats() to authenticated;
revoke execute on function public.whatsapp_ingest(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.whatsapp_outbound(uuid) from public, anon, authenticated;
revoke execute on function public.whatsapp_set_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_ingest(text, text, text, text) to service_role;
grant execute on function public.whatsapp_outbound(uuid) to service_role;
grant execute on function public.whatsapp_set_delivery(uuid, text, text, text) to service_role;
revoke execute on function public.on_chat_message() from public, anon, authenticated;
