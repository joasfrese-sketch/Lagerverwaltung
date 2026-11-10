-- =====================================================================
-- 004: Einladungs-Codes für die Registrierung (wiederholbar, löscht keine Daten)
-- =====================================================================

create table if not exists public.invite_codes (
  code text primary key,
  note text,
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
drop policy if exists invite_admin on public.invite_codes;
create policy invite_admin on public.invite_codes for all to authenticated using (is_admin()) with check (is_admin());

-- Vorab-Prüfung für das Registrierungsformular (liefert nur ja/nein)
create or replace function public.check_invite(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from invite_codes
    where code = upper(trim(coalesce(p_code, ''))) and active
      and (expires_at is null or expires_at > now()) and (max_uses is null or uses < max_uses))
$$;

-- Admin erzeugt einen Code (8 Zeichen)
create or replace function public.create_invite(p_max_uses int default null, p_days int default 14, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_admin() then raise exception 'Nur Administratoren'; end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into invite_codes (code, note, max_uses, expires_at, created_by)
    values (v_code, nullif(trim(p_note), ''), p_max_uses, case when coalesce(p_days, 0) > 0 then now() + make_interval(days => p_days) end, auth.uid());
  return v_code;
end $$;

-- Registrierung nur mit gültigem Code (Admin-E-Mail und vom Admin angelegte Konten ausgenommen)
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

revoke execute on function public.check_invite(text) from public;
grant execute on function public.check_invite(text) to anon, authenticated;
revoke execute on function public.create_invite(int, int, text) from public, anon;
grant execute on function public.create_invite(int, int, text) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
