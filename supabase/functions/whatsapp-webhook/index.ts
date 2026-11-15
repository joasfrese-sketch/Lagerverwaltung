// Edge Function: Eingang für WhatsApp (Meta Cloud API Webhook).
// GET  = Verifizierung beim Einrichten (hub.verify_token muss WHATSAPP_VERIFY_TOKEN entsprechen)
// POST = eingehende Nachrichten; Signatur (X-Hub-Signature-256) wird mit WHATSAPP_APP_SECRET geprüft.
// Übernommen werden nur: Bestätigungscode „VERBINDEN <Code>“, Rufnummern, die ein Administrator mit einem Chat verbunden hat,
// und bestätigte Mitglieder (Antworten landen im Chat der letzten Nachricht, sonst im Gesamtchat).
// Deploy: supabase functions deploy whatsapp-webhook --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseWebhook, verifySignature } from '../_shared/whatsapp.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const token = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    if (token && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === token) {
      return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const secret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!secret) return new Response('not configured', { status: 503 });
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256'), secret))) return new Response('invalid signature', { status: 401 });

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response('bad request', { status: 400 }); }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  for (const m of parseWebhook(payload)) {
    const { data, error } = await admin.rpc('whatsapp_handle_inbound', { p_phone: m.from, p_name: m.name, p_body: m.body, p_wa_id: m.id });
    if (error) { console.error('whatsapp_handle_inbound', error.message); continue; }
    // Nummer bestätigt: kurze Rückmeldung (die Person hat gerade geschrieben, das 24-Stunden-Fenster ist offen)
    if (data?.kind === 'verified' && token && phoneId) {
      const first = String(data.name ?? '').split(' ')[0];
      const text = `✅ Verbunden${first ? ', ' + first : ''}! Du erhältst ab jetzt die Chat-Nachrichten der Lager-App hier per WhatsApp. Deine Antworten landen im Chat, aus dem zuletzt eine Nachricht kam. Abschalten: App → Einstellungen → Profil.`;
      await fetch(`${GRAPH}/${phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: m.from, type: 'text', text: { body: text } }) }).catch(() => null);
    }
  }
  return new Response('ok', { status: 200 }); // Meta erwartet immer schnell 200
});
