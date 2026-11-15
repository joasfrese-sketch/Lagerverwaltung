// Edge Function: leitet eine Chat-Nachricht an die verbundenen WhatsApp-Rufnummern und bestätigten Mitglieder weiter
// und liefert Administratoren den Einrichtungsstatus.
// Aufgerufen vom Datenbank-Trigger (supabase/setup/009_whatsapp_trigger.sql) mit der Nachrichten-ID.
// Schutz: verarbeitet nur frische Nachrichten (max. 10 Min.) und jede Zustellung genau einmal (Reservierung in der DB).
// Solange WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID fehlen, passiert nichts (keine Fehlermeldungen im Chat).
// Innerhalb von 24 h nach der letzten Nachricht der Person wird freier Text gesendet, danach (falls
// WHATSAPP_TEMPLATE_NAME eingerichtet ist) eine genehmigte Vorlage mit zwei Parametern: Absender, Text; sonst „übersprungen“.
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, optional WHATSAPP_TEMPLATE_NAME/_LANG
// Deploy: supabase functions deploy whatsapp-send --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { outboundText, templateParam, interpretSendResult } from '../_shared/whatsapp.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => null);
  const url = env('SUPABASE_URL')!;
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const token = env('WHATSAPP_TOKEN');
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID');

  // ---- Statusprüfung (nur Administratoren, liefert nur Ja/Nein, nie die Werte) ----
  if (body?.check) {
    const caller = createClient(url, env('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Nicht angemeldet' }, 401);
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') return json({ error: 'Nur Administratoren' }, 403);
    const configured = { token: !!token, phone_number_id: !!phoneId, app_secret: !!env('WHATSAPP_APP_SECRET'), verify_token: !!env('WHATSAPP_VERIFY_TOKEN'), template: !!env('WHATSAPP_TEMPLATE_NAME') };
    let graph_ok: boolean | null = null; let graph_error: string | null = null; let display_number: string | null = null;
    if (token && phoneId) {
      try {
        const r = await fetch(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json().catch(() => null);
        graph_ok = r.ok;
        if (r.ok) {
          display_number = String(j?.display_phone_number ?? '').replace(/[^0-9]/g, '') || null;
          if (display_number) await admin.rpc('whatsapp_set_config', { p_key: 'display_number', p_value: display_number });
        } else graph_error = interpretSendResult(r.status, j).error ?? null;
      } catch (e) { graph_ok = false; graph_error = String((e as Error).message ?? e).slice(0, 200); }
    }
    return json({ configured, graph_ok, graph_error, display_number });
  }

  // ---- Versand ----
  const id = String(body?.id ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response('bad request', { status: 400 });
  if (!token || !phoneId) return new Response('not configured'); // noch nicht eingerichtet: nichts versenden, nichts als Fehler vermerken

  const { data: rows, error } = await admin.rpc('whatsapp_outbound', { p_message_id: id });
  if (error) return new Response('error', { status: 500 });
  if (!rows?.length) return new Response('nothing to send');

  const template = env('WHATSAPP_TEMPLATE_NAME');
  const lang = env('WHATSAPP_TEMPLATE_LANG') ?? 'de';
  let sent = 0;
  for (const r of rows) {
    const done = (status: string, err?: string, waId?: string) => admin.rpc('whatsapp_set_delivery', { p_id: r.delivery_id, p_status: status, p_error: err ?? null, p_wa_id: waId ?? null });
    let message: Record<string, unknown>;
    if (r.in_window) message = { messaging_product: 'whatsapp', to: r.phone, type: 'text', text: { body: outboundText(r.sender_label, r.body), preview_url: false } };
    else if (template) message = { messaging_product: 'whatsapp', to: r.phone, type: 'template', template: { name: template, language: { code: lang }, components: [{ type: 'body', parameters: [{ type: 'text', text: templateParam(r.sender_label) }, { type: 'text', text: templateParam(r.body) }] }] } };
    else { await done('skipped', 'Das 24-Stunden-Fenster ist abgelaufen: Die Person muss zuerst eine Nachricht an die Lager-Nummer senden (oder eine Vorlage einrichten).'); continue; }
    try {
      const res = await fetch(`${GRAPH}/${phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
      const out = interpretSendResult(res.status, await res.json().catch(() => null));
      if (out.ok) { sent++; await done('sent', undefined, out.id); } else await done('failed', out.error);
    } catch (e) {
      await done('failed', 'Verbindung zu WhatsApp fehlgeschlagen: ' + String((e as Error).message ?? e).slice(0, 200));
    }
  }
  return json({ sent, total: rows.length });
});
