-- =====================================================================
-- 008 (Setup, nicht Teil der automatischen Tests): Push-Nachrichten auslösen
-- Ruft bei jeder neuen, ungelesenen Mitteilung die Edge Function „send-push“ auf (asynchron über pg_net,
-- bremst oder blockiert keine Buchung). Ersetzt den manuellen „Database Webhook“ aus der README.
-- Vorher: send-push deployen und das Secret VAPID_PRIVATE_KEY setzen.
-- Projekt-URL unten anpassen, falls ein anderes Supabase-Projekt verwendet wird.
-- =====================================================================
create extension if not exists pg_net with schema extensions;

alter table public.notifications add column if not exists pushed_at timestamptz;

create or replace function public.trg_notification_push() returns trigger
language plpgsql security definer set search_path = public, extensions, net as $$
begin
  begin
    perform net.http_post(
      url := 'https://qqjtlcdqhyglhbcixvbr.supabase.co/functions/v1/send-push',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('id', new.id),
      timeout_milliseconds := 5000);
  exception when others then
    null; -- Push ist optional: Fehler dürfen die eigentliche Aktion nie verhindern
  end;
  return null;
end $$;
revoke execute on function public.trg_notification_push() from public, anon, authenticated;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row when (new.read_at is null)
  execute function public.trg_notification_push();
