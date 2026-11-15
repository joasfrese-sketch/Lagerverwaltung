// Edge Function: leitet eine Chat-Nachricht an die verbundenen WhatsApp-Rufnummern weiter.
// Aufgerufen vom Datenbank-Trigger (supabase/setup/009_whatsapp_trigger.sql) mit der Nachrichten-ID.
// Schutz: verarbeitet nur frische Nachrichten (max. 10 Min.) und jede Zustellung genau einmal (Reservierung in der DB).
// Innerhalb von 24 h nach der letzten Nachricht der Person wird freier Text gesendet, danach (falls
// WHATSAPP_TEMPLATE_NAME eingerichtet ist) eine genehmigte Vorlage mit zwei Parametern: Absender, Text.
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, optional WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG
// Deploy: supabase functions deploy whatsapp-send --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { outboundText, templateParam, interpretSendResult } from './whatsapp.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

Deno.serve(async (req) => {
  let id = '';
  try { const b = await req.json(); id = String(b?.id ?? ''); } catch { /* ungültiger Body */ }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response('bad request', { status: 400 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: rows, error } = await admin.rpc('whatsapp_outbound', { p_message_id: id });
  if (error) return new Response('error', { status: 500 });
  if (!rows?.length) return new Response('nothing to send');

  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const template = Deno.env.get('WHATSAPP_TEMPLATE_NAME');
  const lang = Deno.env.get('WHATSAPP_TEMPLATE_LANG') ?? 'de';
  let sent = 0;
  for (const r of rows) {
    const done = (status: string, err?: string, waId?: string) => admin.rpc('whatsapp_set_delivery', { p_id: r.delivery_id, p_status: status, p_error: err ?? null, p_wa_id: waId ?? null });
    if (!token || !phoneId) { await done('failed', 'WhatsApp-Zugang ist noch nicht eingerichtet (Secrets fehlen).'); continue; }
    let message: Record<string, unknown>;
    if (r.in_window) message = { messaging_product: 'whatsapp', to: r.phone, type: 'text', text: { body: outboundText(r.sender_label, r.body), preview_url: false } };
    else if (template) message = { messaging_product: 'whatsapp', to: r.phone, type: 'template', template: { name: template, language: { code: lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: templateParam(r.sender_label) }, { type: 'text', text: templateParam(r.body) }] }] } };
    else { await done('failed', 'Das 24-Stunden-Fenster ist abgelaufen: Die Person muss zuerst eine Nachricht senden (oder eine Vorlage einrichten).'); continue; }
    try {
      const res = await fetch(`${GRAPH}/${phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
      const json = await res.json().catch(() => null);
      const out = interpretSendResult(res.status, json);
      if (out.ok) { sent++; await done('sent', undefined, out.id); } else await done('failed', out.error);
    } catch (e) {
      await done('failed', 'Verbindung zu WhatsApp fehlgeschlagen: ' + String((e as Error).message ?? e).slice(0, 200));
    }
  }
  return new Response(JSON.stringify({ sent, total: rows.length }), { headers: { 'Content-Type': 'application/json' } });
});
