// WhatsApp für das eigene Profil: Nummer + Zustimmung speichern, Nummer per WhatsApp bestätigen
import { supabase, unwrap, safeData } from '../lib/supabase.js';
import { esc, toast, busy } from '../lib/ui.js';
import { state } from '../state.js';
import { normalizePhone, prettyPhone } from '../../supabase/functions/_shared/whatsapp.js';

async function load() {
  const me = await safeData(supabase.from('profiles').select('phone, whatsapp_optin, whatsapp_verified_at, wa_verify_code').eq('id', state.user.id).maybeSingle(), null);
  const cfg = await safeData(supabase.from('whatsapp_config').select('value').eq('key', 'display_number').maybeSingle(), null);
  return { me, number: cfg?.value || '' };
}

export const waStatusText = (me) => (!me?.phone ? 'Nicht eingerichtet' : !me.whatsapp_optin ? 'Aus' : me.whatsapp_verified_at ? 'Verbunden' : 'Wartet auf Bestätigung');

export async function mountWhatsAppProfile(box) {
  let timer = null;
  const draw = async () => {
    if (!box.isConnected) { clearInterval(timer); return; }
    const { me, number } = await load();
    if (me === null) { box.innerHTML = '<p class="text-sm text-slate-500">WhatsApp ist noch nicht eingerichtet (Migration 010 fehlt).</p>'; return; }
    const verified = !!(me.phone && me.whatsapp_optin && me.whatsapp_verified_at);
    const pending = !!(me.phone && me.whatsapp_optin && !me.whatsapp_verified_at);
    const link = number && me.wa_verify_code ? `https://wa.me/${number}?text=${encodeURIComponent('VERBINDEN ' + me.wa_verify_code)}` : '';
    box.innerHTML = `
      <p class="mb-3 text-xs text-slate-500">Mit deiner Mobilnummer kannst du die Nachrichten aus <b>allen deinen Chats</b> (auch Direktchats) per WhatsApp erhalten und von dort antworten. Antworten landen in dem Chat, aus dem zuletzt eine Nachricht kam – sonst im Gesamtchat.</p>
      <form id="waForm" class="space-y-3">
        <div><label class="label">Mobilnummer</label><input name="phone" class="input" inputmode="tel" autocomplete="tel" placeholder="+49 151 2345678" value="${esc(prettyPhone(me.phone))}"></div>
        <label class="flex items-start gap-2 text-sm"><input type="checkbox" name="optin" class="mt-1 h-5 w-5 rounded text-brand-600" ${me.whatsapp_optin ? 'checked' : ''}> <span>Ich möchte die Chat-Nachrichten der Lager-App per WhatsApp erhalten. Ich kann das jederzeit hier abschalten.</span></label>
        <button class="btn-primary">Speichern</button>
      </form>
      ${verified ? `<div class="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✅ <b>Verbunden.</b> Chat-Nachrichten kommen jetzt auf ${esc(prettyPhone(me.phone))} an. Hinweis: Die App kann dir nur schreiben, solange du in den letzten 24 Stunden selbst eine Nachricht an die Lager-Nummer gesendet hast.</div>` : ''}
      ${pending ? `<div class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><b>Fast fertig – bitte bestätigen:</b> Sende von <b>${esc(prettyPhone(me.phone))}</b> per WhatsApp die Nachricht <code class="rounded bg-white px-1.5 py-0.5 font-mono font-bold">VERBINDEN ${esc(me.wa_verify_code || '')}</code> an ${number ? `<b>+${esc(number)}</b>` : 'die WhatsApp-Nummer der Lager-App'}.
        ${link ? `<a class="btn-primary mt-2 w-full" href="${esc(link)}" target="_blank" rel="noopener">In WhatsApp öffnen</a>` : '<div class="mt-1 text-xs">Die Lager-Nummer ist noch nicht hinterlegt – bitte beim Administrator nachfragen.</div>'}
        <button id="waRefresh" type="button" class="btn-ghost mt-2 w-full">Status prüfen</button></div>` : ''}`;
    box.querySelector('#waForm').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target); const phone = String(f.get('phone') || '').trim(); const optin = f.get('optin') === 'on';
      if (phone) { const n = normalizePhone(phone); if (!n.ok) return toast(n.error, 'error'); }
      if (optin && !phone) return toast('Bitte zuerst eine Mobilnummer eingeben.', 'error');
      busy(e.target.querySelector('button'), async () => {
        const r = unwrap(await supabase.rpc('set_my_whatsapp', { p_phone: phone, p_optin: optin }));
        toast(r.status === 'verified' ? 'Gespeichert – bereits verbunden' : r.status === 'pending' ? 'Gespeichert – bitte jetzt die Nummer bestätigen' : 'Gespeichert', 'success');
        await draw();
      });
    };
    box.querySelector('#waRefresh')?.addEventListener('click', () => draw());
    clearInterval(timer);
    if (pending) timer = setInterval(draw, 5000); // wartet auf die Bestätigung per WhatsApp
  };
  await draw();
}
