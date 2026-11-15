-- =====================================================================
-- 010: Telefonnummer im Profil, WhatsApp automatisch für Mitglieder (nach Zustimmung und Bestätigung)
-- Nutzer tragen Nummer + Zustimmung ein und bestätigen die Nummer, indem sie von ihr „VERBINDEN <Code>“ an die
-- Lager-WhatsApp-Nummer schicken (Schutz davor, fremde Nummern einzutragen). Danach erhalten sie alle Nachrichten
-- ihrer Chats per WhatsApp; ihre Antworten landen im Chat, aus dem zuletzt eine Nachricht kam (sonst im Gesamtchat).
-- (nach 001–009 einmal ausführen, wiederholbar, löscht keine Daten)
-- =====================================================================

-- ---------- Profil ----------
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists whatsapp_optin boolean not null default false;
alter table public.profiles add column if not exists whatsapp_optin_at timestamptz;
alter table public.profiles add column if not exists whatsapp_verified_at timestamptz;
alter table public.profiles add column if not exists wa_verify_code text;
alter table public.profiles drop constraint if exists profiles_phone_chk;
alter table public.profiles add constraint profiles_phone_chk
  check ((phone is null or phone ~ '^[0-9]{8,15}$') and (not whatsapp_optin or phone is not null));
create unique index if not exists profiles_phone_uq on public.profiles(phone) where phone is not null;

-- Telefon-/WhatsApp-Felder dürfen nur über die Funktion set_my_whatsapp geändert werden (Administratoren ausgenommen)
create or replace function public.protect_profile_columns() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.role is distinct from old.role or new.managed_room is distinct from old.managed_room
       or new.email is distinct from old.email or new.id is distinct from old.id then
      raise exception 'Keine Berechtigung, Rolle, Raum oder E-Mail zu ändern';
    end if;
    if (new.phone is distinct from old.phone or new.whatsapp_optin is distinct from old.whatsapp_optin
        or new.whatsapp_verified_at is distinct from old.whatsapp_verified_at or new.wa_verify_code is distinct from old.wa_verify_code)
       and coalesce(current_setting('lager.wa', true), '') <> 'on' then
      raise exception 'Telefonnummer und WhatsApp bitte über Einstellungen → Profil ändern';
    end if;
  end if;
  return new;
end $$;

-- Registrierung: optional Nummer + Zustimmung übernehmen (bleibt unbestätigt, bis die Person sie per WhatsApp bestätigt)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_user text; v_code text := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
        v_phone text; v_optin boolean := coalesce(new.raw_user_meta_data->>'whatsapp_optin', '') = 'true';
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
  begin v_phone := wa_normalize_phone(new.raw_user_meta_data->>'phone'); exception when others then v_phone := null; end;
  if v_phone is not null and exists (select 1 from profiles where phone = v_phone) then v_phone := null; end if;
  v_optin := v_optin and v_phone is not null;
  insert into profiles (id, email, username, full_name, role, phone, whatsapp_optin, whatsapp_optin_at, wa_verify_code)
    values (new.id, lower(new.email), v_user, coalesce(new.raw_user_meta_data->>'full_name',''),
            case when lower(new.email) = 'joas.frese@gmail.com' then 'admin' else 'user' end,
            v_phone, v_optin, case when v_optin then now() end,
            case when v_optin then upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)) end);
  insert into user_settings (user_id, prefs)
    values (new.id, '{"notify_deadline":true,"notify_rental":true,"notify_chat":true,"push":true,"calendar_view":"month"}'::jsonb
                    || jsonb_build_object('profile_done', coalesce(new.raw_user_meta_data->>'username', '') <> ''));
  insert into chat_members (chat_id, user_id) values ('00000000-0000-0000-0000-0000000000c1', new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------- Einstellungen der Nutzer ----------
create or replace function public.set_my_whatsapp(p_phone text, p_optin boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me profiles; v_phone text; v_code text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  perform set_config('lager.wa', 'on', true);
  if coalesce(trim(p_phone), '') = '' then
    update profiles set phone = null, whatsapp_optin = false, whatsapp_optin_at = null, whatsapp_verified_at = null, wa_verify_code = null where id = auth.uid();
    return jsonb_build_object('status', 'off');
  end if;
  v_phone := wa_normalize_phone(p_phone);
  if exists (select 1 from profiles where phone = v_phone and id <> auth.uid()) then
    raise exception 'Diese Rufnummer wird bereits von einem anderen Konto verwendet.';
  end if;
  select * into me from profiles where id = auth.uid();
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  if me.phone is distinct from v_phone then
    update profiles set phone = v_phone, whatsapp_optin = coalesce(p_optin, false), whatsapp_optin_at = case when p_optin then now() end,
      whatsapp_verified_at = null, wa_verify_code = case when p_optin then v_code end where id = auth.uid();
  else
    update profiles set whatsapp_optin = coalesce(p_optin, false),
      whatsapp_optin_at = case when p_optin and not me.whatsapp_optin then now() when p_optin then whatsapp_optin_at end,
      wa_verify_code = case when p_optin and whatsapp_verified_at is null then coalesce(wa_verify_code, v_code) else null end
     where id = auth.uid();
  end if;
  select * into me from profiles where id = auth.uid();
  return jsonb_build_object('status', case when not me.whatsapp_optin then 'off' when me.whatsapp_verified_at is not null then 'verified' else 'pending' end,
                            'phone', me.phone, 'code', me.wa_verify_code);
end $$;

-- Öffentliche Angaben für die Anleitung (Lager-WhatsApp-Nummer wird von der Edge Function eingetragen)
create table if not exists public.whatsapp_config (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.whatsapp_config enable row level security;
drop policy if exists wa_config_read on public.whatsapp_config;
create policy wa_config_read on public.whatsapp_config for select to authenticated using (key = 'display_number');
create or replace function public.whatsapp_set_config(p_key text, p_value text) returns void
language sql security definer set search_path = public as $$
  insert into whatsapp_config (key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value, updated_at = now()
$$;

-- ---------- Zustellungen: auch an Mitglieder; Status „übersprungen“ (24-h-Fenster zu) ----------
alter table public.whatsapp_deliveries alter column contact_id drop not null;
alter table public.whatsapp_deliveries add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.whatsapp_deliveries drop constraint if exists whatsapp_deliveries_target_chk;
alter table public.whatsapp_deliveries add constraint whatsapp_deliveries_target_chk check (contact_id is not null or user_id is not null);
alter table public.whatsapp_deliveries drop constraint if exists whatsapp_deliveries_status_check;
alter table public.whatsapp_deliveries add constraint whatsapp_deliveries_status_check check (status in ('pending', 'sent', 'failed', 'skipped'));
create unique index if not exists whatsapp_deliveries_user_uq on public.whatsapp_deliveries(message_id, user_id) where user_id is not null;

-- Status je Mitglied: letzte Nachricht der Person (24-h-Fenster) und Chat für Antworten
create table if not exists public.whatsapp_member_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_inbound_at timestamptz,
  active_chat_id uuid references public.chats(id) on delete set null,
  active_at timestamptz
);
alter table public.whatsapp_member_state enable row level security;

-- verbundene Chats: ausdrücklich verbundene Nummern + bestätigte Mitglieder (ohne mich selbst)
create or replace function public.whatsapp_bridged_chats() returns table (chat_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select c.id, (
      (select count(*) from whatsapp_contacts w where w.chat_id = c.id)
      + (select count(*) from chat_members cm join profiles p on p.id = cm.user_id
          where cm.chat_id = c.id and p.whatsapp_optin and p.whatsapp_verified_at is not null and p.id <> auth.uid())
    )::int as n
  from chats c where is_chat_member(c.id)
  and ((select count(*) from whatsapp_contacts w where w.chat_id = c.id)
     + (select count(*) from chat_members cm join profiles p on p.id = cm.user_id
         where cm.chat_id = c.id and p.whatsapp_optin and p.whatsapp_verified_at is not null and p.id <> auth.uid())) > 0
$$;

-- Ausgehend: Rufnummern + Mitglieder; Absenderzeile nennt bei Gruppen/Direktchats den Chat
create or replace function public.whatsapp_outbound(p_message_id uuid)
returns table (delivery_id uuid, phone text, contact_name text, in_window boolean, sender_label text, body text)
language plpgsql security definer set search_path = public as $$
declare m chat_messages; ch chats; v_sender text; v_label text;
begin
  select * into m from chat_messages where id = p_message_id and created_at > now() - interval '10 minutes';
  if not found then return; end if;
  select * into ch from chats where id = m.chat_id;
  if m.sender_id is not null then select coalesce(nullif(trim(full_name), ''), username) into v_sender from profiles where id = m.sender_id;
  else v_sender := coalesce(nullif(m.wa_name, ''), '+' || m.wa_phone); end if;
  v_label := case ch.type when 'group' then coalesce(ch.name, 'Gruppe') || ' · ' || v_sender
                          when 'direct' then v_sender || ' (privat)' else v_sender end;
  return query
    with c_ins as (
      insert into whatsapp_deliveries (message_id, chat_id, contact_id)
        select m.id, m.chat_id, c.id from whatsapp_contacts c where c.chat_id = m.chat_id and c.phone is distinct from m.wa_phone
        on conflict do nothing returning id, contact_id),
    u_ins as (
      insert into whatsapp_deliveries (message_id, chat_id, user_id)
        select m.id, m.chat_id, p.id from chat_members cm join profiles p on p.id = cm.user_id
         where cm.chat_id = m.chat_id and p.whatsapp_optin and p.whatsapp_verified_at is not null and p.phone is not null
           and p.id is distinct from m.sender_id and p.phone is distinct from m.wa_phone
        on conflict do nothing returning id, user_id),
    mark as (
      insert into whatsapp_member_state (user_id, active_chat_id, active_at) select u_ins.user_id, m.chat_id, now() from u_ins
      on conflict (user_id) do update set active_chat_id = excluded.active_chat_id, active_at = excluded.active_at
      returning user_id)
    select c_ins.id, c.phone, c.name, coalesce(c.last_inbound_at > now() - interval '23 hours 30 minutes', false), v_label, m.body
      from c_ins join whatsapp_contacts c on c.id = c_ins.contact_id
    union all
    select u_ins.id, p.phone, p.full_name, coalesce(s.last_inbound_at > now() - interval '23 hours 30 minutes', false), v_label, m.body
      from u_ins join profiles p on p.id = u_ins.user_id left join whatsapp_member_state s on s.user_id = p.id;
end $$;

create or replace function public.whatsapp_set_delivery(p_id uuid, p_status text, p_error text default null, p_wa_id text default null) returns void
language sql security definer set search_path = public as $$
  update whatsapp_deliveries set status = p_status, error = left(p_error, 500), wa_message_id = p_wa_id
   where id = p_id and p_status in ('sent', 'failed', 'skipped')
$$;

-- ---------- Eingang: Bestätigung, Rufnummern, Mitglieder ----------
create or replace function public.whatsapp_handle_inbound(p_phone text, p_name text, p_body text, p_wa_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_phone text; v_code text; p profiles; st whatsapp_member_state; v_chat uuid; v_n int := 0; v_ins int;
begin
  begin v_phone := wa_normalize_phone('+' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'));
  exception when others then return jsonb_build_object('kind', 'ignored'); end;
  -- 1) Bestätigung der Nummer: „VERBINDEN ABC123“
  v_code := upper((regexp_match(coalesce(p_body, ''), '^\s*verbinden\s+([a-z0-9]{6})\s*$', 'i'))[1]);
  if v_code is not null then
    perform set_config('lager.wa', 'on', true);
    update profiles set whatsapp_verified_at = now(), wa_verify_code = null
     where phone = v_phone and wa_verify_code = v_code and whatsapp_optin returning * into p;
    if found then
      insert into whatsapp_member_state (user_id, last_inbound_at) values (p.id, now())
        on conflict (user_id) do update set last_inbound_at = now();
      return jsonb_build_object('kind', 'verified', 'name', p.full_name);
    end if;
  end if;
  -- 2) ausdrücklich verbundene Rufnummern (Einzelpersonen/Verteiler)
  v_n := whatsapp_ingest(p_phone, p_name, p_body, p_wa_id);
  -- 3) bestätigte Mitglieder: Antwort in den Chat, aus dem zuletzt eine Nachricht kam (24 h), sonst Gesamtchat
  select * into p from profiles where phone = v_phone and whatsapp_optin and whatsapp_verified_at is not null;
  if found then
    select * into st from whatsapp_member_state where user_id = p.id;
    v_chat := case when st.active_chat_id is not null and st.active_at > now() - interval '24 hours'
                    and exists (select 1 from chat_members where chat_id = st.active_chat_id and user_id = p.id)
                   then st.active_chat_id else '00000000-0000-0000-0000-0000000000c1'::uuid end;
    insert into chat_messages (chat_id, sender_id, body, source, wa_phone, wa_message_id)
      values (v_chat, p.id, left(coalesce(p_body, ''), 4000), 'whatsapp', v_phone, p_wa_id)
      on conflict (chat_id, wa_message_id) where wa_message_id is not null do nothing;
    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
    insert into whatsapp_member_state (user_id, last_inbound_at, active_chat_id, active_at) values (p.id, now(), v_chat, now())
      on conflict (user_id) do update set last_inbound_at = now(), active_chat_id = v_chat, active_at = now();
  end if;
  return jsonb_build_object('kind', case when v_n > 0 then 'chat' else 'ignored' end, 'n', v_n);
end $$;

-- ---------- Rechte ----------
revoke execute on function public.set_my_whatsapp(text, boolean) from public, anon;
grant execute on function public.set_my_whatsapp(text, boolean) to authenticated;
revoke execute on function public.whatsapp_handle_inbound(text, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_handle_inbound(text, text, text, text) to service_role;
revoke execute on function public.whatsapp_set_config(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_set_config(text, text) to service_role;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;
revoke execute on function public.whatsapp_bridged_chats() from public, anon;
grant execute on function public.whatsapp_bridged_chats() to authenticated;
revoke execute on function public.whatsapp_outbound(uuid) from public, anon, authenticated;
revoke execute on function public.whatsapp_set_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_outbound(uuid) to service_role;
grant execute on function public.whatsapp_set_delivery(uuid, text, text, text) to service_role;
