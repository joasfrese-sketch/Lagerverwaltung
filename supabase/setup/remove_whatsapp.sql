-- =====================================================================
-- WhatsApp-Anbindung wieder entfernen (Rückbau)
-- Stellt den Datenbankstand ohne WhatsApp wieder her: Tabellen, Funktionen, Auslöser und Spalten werden gelöscht,
-- die ursprünglichen Funktionen für Chat-Benachrichtigung, Registrierung und Profilschutz kommen zurück.
-- Der interne Chat, Benachrichtigungen und Push bleiben unverändert.
-- In Supabase → SQL Editor einfügen und "Run" klicken. Wiederholbar.
-- =====================================================================

-- 1) Auslöser und WhatsApp-Funktionen
drop trigger if exists chat_messages_whatsapp on public.chat_messages;
drop function if exists public.trg_chat_message_whatsapp();
drop function if exists public.whatsapp_handle_inbound(text, text, text, text);
drop function if exists public.whatsapp_ingest(text, text, text, text);
drop function if exists public.whatsapp_outbound(uuid);
drop function if exists public.whatsapp_set_delivery(uuid, text, text, text);
drop function if exists public.whatsapp_set_config(text, text);
drop function if exists public.whatsapp_bridged_chats();
drop function if exists public.whatsapp_add_contact(uuid, text, text);
drop function if exists public.whatsapp_remove_contact(uuid);
drop function if exists public.whatsapp_create_chat(text, text, text);
drop function if exists public.set_my_whatsapp(text, boolean);

-- 2) Ursprüngliche Funktionen wiederherstellen (vor dem Löschen der Spalten)
create or replace function public.on_chat_message() returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text; v_name text; v_sender text; m record;
begin
  select type, name into v_type, v_name from chats where id = new.chat_id;
  if v_type = 'global' then return new; end if;
  select full_name into v_sender from profiles where id = new.sender_id;
  for m in select user_id from chat_members where chat_id = new.chat_id and user_id <> new.sender_id loop
    if not exists (select 1 from notifications where user_id = m.user_id and link = 'chat:' || new.chat_id and read_at is null) then
      perform notify_user(m.user_id,
        coalesce(nullif(v_sender,''),'Neue Nachricht') || case when v_type = 'group' then ' in ' || coalesce(v_name,'Gruppe') else '' end,
        left(new.body, 140), 'chat', 'chat:' || new.chat_id);
    end if;
  end loop;
  return new;
end $$;
revoke execute on function public.on_chat_message() from public, anon, authenticated;

create or replace function public.protect_profile_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() and
     (new.role is distinct from old.role or new.managed_room is distinct from old.managed_room
      or new.email is distinct from old.email or new.id is distinct from old.id) then
    raise exception 'Keine Berechtigung, Rolle, Raum oder E-Mail zu ändern';
  end if;
  return new;
end $$;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_user text; v_code text := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
begin
  if lower(new.email) <> 'joas.frese@gmail.com' and coalesce(new.raw_app_meta_data->>'admin_created', '') <> 'true' then
    update invite_codes set uses = uses + 1
      where code = v_code and active and (expires_at is null or expires_at > now()) and (max_uses is null or uses < max_uses);
    if not found then raise exception 'Ungültiger oder abgelaufener Einladungs-Code'; end if;
  end if;
  v_user := lower(coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1)));
  v_user := regexp_replace(v_user, '[^a-z0-9._-]', '', 'g');
  if length(v_user) < 3 then v_user := v_user || 'user'; end if;
  v_user := left(v_user, 24);
  while exists (select 1 from profiles where username = v_user) loop
    v_user := left(v_user, 24) || floor(random()*900 + 100)::int;
  end loop;
  insert into profiles (id, email, username, full_name, role)
    values (new.id, lower(new.email), v_user, coalesce(new.raw_user_meta_data->>'full_name',''),
            case when lower(new.email) = 'joas.frese@gmail.com' then 'admin' else 'user' end);
  insert into user_settings (user_id, prefs)
    values (new.id, '{"notify_deadline":true,"notify_rental":true,"notify_chat":true,"push":true,"calendar_view":"month"}'::jsonb
                    || jsonb_build_object('profile_done', coalesce(new.raw_user_meta_data->>'username', '') <> ''));
  insert into chat_members (chat_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3) Tabellen
drop table if exists public.whatsapp_deliveries cascade;
drop table if exists public.whatsapp_member_state cascade;
drop table if exists public.whatsapp_contacts cascade;
drop table if exists public.whatsapp_config cascade;
drop function if exists public.wa_normalize_phone(text);

-- 4) Chat-Nachrichten: nur Nachrichten mit App-Absender bleiben (Nachrichten aus WhatsApp gab es nur nach der Einrichtung bei Meta)
drop index if exists public.chat_messages_wa_unique;
alter table public.chat_messages drop constraint if exists chat_messages_source_chk;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'source') then
    delete from public.chat_messages where source = 'whatsapp' or sender_id is null;
  end if;
end $$;
alter table public.chat_messages alter column sender_id set not null;
alter table public.chat_messages drop column if exists source;
alter table public.chat_messages drop column if exists wa_name;
alter table public.chat_messages drop column if exists wa_phone;
alter table public.chat_messages drop column if exists wa_message_id;

-- 5) Profil
alter table public.profiles drop constraint if exists profiles_phone_chk;
drop index if exists public.profiles_phone_uq;
alter table public.profiles drop column if exists phone;
alter table public.profiles drop column if exists whatsapp_optin;
alter table public.profiles drop column if exists whatsapp_optin_at;
alter table public.profiles drop column if exists whatsapp_verified_at;
alter table public.profiles drop column if exists wa_verify_code;

-- 6) Protokolleinträge zu WhatsApp entfernen
delete from public.activity_log where action = 'WHATSAPP';
