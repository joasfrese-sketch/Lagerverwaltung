// Edge Function: sendet Web-Push für jede neue (ungelesene) Mitteilung an den jeweiligen Nutzer.
// Aufruf: ein Datenbank-Trigger (supabase/setup/008_push_trigger.sql) sendet die Mitteilungs-ID.
// Schutz: Die Funktion verarbeitet nur eine frische (max. 5 Min.), ungelesene und noch nicht
// verschickte Mitteilung genau einmal. Die ID ist eine zufällige UUID – Dritte können sie nicht erraten.
// Eigene Aktionen des Nutzers sind in der DB bereits als gelesen markiert und lösen keinen Push aus.
// Geheimnis (nur als Supabase-Secret): VAPID_PRIVATE_KEY. Öffentlicher Schlüssel und Absender sind unten voreingestellt.
// Deploy: supabase functions deploy send-push --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? 'BHOJL7i9uNl71klFGgmEv7SitieJIdyoBx8iI0Bs_-sl0BW1dPEKVeSXrcEt1iig3rRDjBrrIXtX3QDyjLqZt2g';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://lagerverwaltung-mbg.vercel.app';

const urlFor = (link?: string | null) => {
  if (!link) return '/#/chat';
  if (link.startsWith('chat:')) return '/#/chat';
  if (link.startsWith('rental:')) return '/#/ich';
  if (link.startsWith('ext:')) return '/#/terminal';
  return '/#/katalog';
};

Deno.serve(async (req) => {
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!priv) return new Response('push not configured', { status: 503 });
  let id = '';
  try { const b = await req.json(); id = String(b?.id ?? b?.record?.id ?? ''); } catch { /* ungültiger Body */ }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response('bad request', { status: 400 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // Einmal-Freigabe: markiert die Mitteilung atomar als verschickt
  const { data: n } = await admin.from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .eq('id', id).is('pushed_at', null).is('read_at', null)
    .gt('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
    .select('user_id, title, body, link').maybeSingle();
  if (!n) return new Response('skipped');

  const { data: s } = await admin.from('user_settings').select('prefs').eq('user_id', n.user_id).maybeSingle();
  if (s?.prefs?.push === false) return new Response('disabled');
  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', n.user_id);
  if (!subs?.length) return new Response('no subscriptions');

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, priv);
  const payload = JSON.stringify({ title: n.title, body: n.body, url: urlFor(n.link) });
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
