// Einrichtungsstatus der WhatsApp-Anbindung (nur Administratoren): zeigt, welche Secrets fehlen
import { supabase } from '../lib/supabase.js';
import { esc, busy } from '../lib/ui.js';

const ROWS = [
  ['token', 'Zugangstoken (WHATSAPP_TOKEN)', true],
  ['phone_number_id', 'Telefonnummer-ID (WHATSAPP_PHONE_NUMBER_ID)', true],
  ['app_secret', 'App-Geheimschlüssel (WHATSAPP_APP_SECRET)', true],
  ['verify_token', 'Verifizierungstext (WHATSAPP_VERIFY_TOKEN)', true],
  ['template', 'Vorlage für Nachrichten nach 24 h (WHATSAPP_TEMPLATE_NAME)', false],
];

export function mountWhatsAppStatus(box) {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const run = async () => {
    box.querySelector('#waOut').innerHTML = '<p class="text-sm text-slate-400">Prüfe…</p>';
    const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: { check: true } });
    const out = box.querySelector('#waOut');
    if (error || !data || data.error) { out.innerHTML = `<p class="text-sm text-red-600">${esc(data?.error || 'Die Funktion „whatsapp-send“ ist nicht erreichbar (nicht veröffentlicht?).')}</p>`; return; }
    const c = data.configured;
    const missing = ROWS.filter(([k, , req]) => req && !c[k]).length;
    out.innerHTML = `<ul class="space-y-1 text-sm">${ROWS.map(([k, l, req]) => `<li>${c[k] ? '✅' : req ? '❌' : '➖'} ${esc(l)}${req ? '' : ' <span class="text-xs text-slate-400">(optional)</span>'}</li>`).join('')}
      <li>${data.graph_ok === null ? '➖' : data.graph_ok ? '✅' : '❌'} Verbindung zu Meta${data.graph_error ? ': <span class="text-red-600">' + esc(data.graph_error) + '</span>' : ''}${data.display_number ? ' · Lager-Nummer <b>+' + esc(data.display_number) + '</b>' : ''}</li></ul>
      <p class="mt-2 rounded-xl p-2.5 text-sm ${missing ? 'bg-amber-50 text-amber-800' : data.graph_ok ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}">${missing ? `Es fehlen noch ${missing} Secret(s). Eintragen unter Supabase → Edge Functions → Secrets. Bis dahin werden keine WhatsApp-Nachrichten versendet.` : data.graph_ok ? 'Alles eingerichtet. Fehlt nur noch der Webhook bei Meta (siehe unten), damit Antworten ankommen.' : 'Secrets sind eingetragen, aber Meta lehnt die Verbindung ab – siehe Meldung oben.'}</p>`;
  };
  box.innerHTML = `<div id="waOut"><p class="text-sm text-slate-400">Prüfe…</p></div>
    <button id="waCheck" class="btn-ghost mt-3">Verbindung prüfen</button>
    <div class="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>Webhook-URL für Meta:</b><br><code class="break-all">${esc(base)}/functions/v1/whatsapp-webhook</code><br>Abonnieren: <b>messages</b>. Anleitung: Datei <code>docs/whatsapp.md</code> im Projekt.</div>`;
  box.querySelector('#waCheck').onclick = (e) => busy(e.target, run, { offlineOk: false });
  run();
}
