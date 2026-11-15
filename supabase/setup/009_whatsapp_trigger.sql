-- =====================================================================
-- 009 (Setup, nicht Teil der automatischen Tests): WhatsApp-Versand auslösen
-- Ruft bei jeder neuen Chat-Nachricht in einem verbundenen Chat die Edge Function „whatsapp-send“ auf
-- (asynchron über pg_net; Fehler bremsen das Senden in der App nie).
-- Vorher: Migration 009_whatsapp.sql und Edge Function whatsapp-send deployen. Projekt-URL ggf. anpassen.
-- =====================================================================
create extension if not exists pg_net with schema extensions;

create or replace function public.trg_chat_message_whatsapp() returns trigger
language plpgsql security definer set search_path = public, extensions, net as $$
begin
  if not exists (select 1 from whatsapp_contacts where chat_id = new.chat_id) then return null; end if;
  begin
    perform net.http_post(
      url := 'https://qqjtlcdqhyglhbcixvbr.supabase.co/functions/v1/whatsapp-send',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('id', new.id),
      timeout_milliseconds := 5000);
  exception when others then
    null;
  end;
  return null;
end $$;
revoke execute on function public.trg_chat_message_whatsapp() from public, anon, authenticated;

drop trigger if exists chat_messages_whatsapp on public.chat_messages;
create trigger chat_messages_whatsapp after insert on public.chat_messages
  for each row execute function public.trg_chat_message_whatsapp();
