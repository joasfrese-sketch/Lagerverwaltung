// Edge Function: Eingang für WhatsApp (Meta Cloud API Webhook).
// GET  = Verifizierung beim Einrichten (hub.verify_token muss WHATSAPP_VERIFY_TOKEN entsprechen)
// POST = eingehende Nachrichten; Signatur (X-Hub-Signature-256) wird mit WHATSAPP_APP_SECRET geprüft.
// Nur Rufnummern, die ein Administrator mit einem Chat verbunden hat, werden übernommen.
// Deploy: supabase functions deploy whatsapp-webhook --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseWebhook, verifySignature } from './whatsapp.js';

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
  for (const m of parseWebhook(payload)) {
    const { error } = await admin.rpc('whatsapp_ingest', { p_phone: m.from, p_name: m.name, p_body: m.body, p_wa_id: m.id });
    if (error) console.error('whatsapp_ingest', error.message);
  }
  return new Response('ok', { status: 200 }); // Meta erwartet immer schnell 200
});
