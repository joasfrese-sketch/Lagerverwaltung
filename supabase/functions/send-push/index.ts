// Edge Function: sendet Web-Push für jede neue (ungelesene) Mitteilung an den jeweiligen Nutzer.
// Eigene Aktionen des Nutzers sind in der DB bereits als gelesen markiert und lösen keinen Push aus.
// Aufruf per Database Webhook (Tabelle notifications, INSERT) mit Header x-webhook-secret.
// Deploy: supabase functions deploy send-push --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const urlFor = (link?: string | null) => {
  if (!link) return '/#/chat';
  if (link.startsWith('chat:')) return '/#/chat';
  if (link.startsWith('rental:')) return '/#/ich';
  return '/#/katalog';
};

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('PUSH_WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 });
  const { record } = await req.json();
  if (!record || record.read_at) return new Response('skipped');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: s } = await admin.from('user_settings').select('prefs').eq('user_id', record.user_id).maybeSingle();
  if (s?.prefs?.push === false) return new Response('disabled');

  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', record.user_id);
  if (!subs?.length) return new Response('no subscriptions');
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
  const payload = JSON.stringify({ title: record.title, body: record.body, url: urlFor(record.link) });
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id);
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
});
