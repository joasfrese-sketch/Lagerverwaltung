// WhatsApp-Verwaltung für Chats (nur Administratoren): Rufnummern verbinden/trennen, neuen WhatsApp-Chat anlegen
import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, busy, openModal, fmtDateTime } from '../lib/ui.js';
import { normalizePhone, prettyPhone } from '../../supabase/functions/_shared/whatsapp.js';

const HINT = `<div class="rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>Bitte beachten:</b>
  <ul class="mt-1 list-disc space-y-0.5 pl-4"><li>Nur Personen eintragen, die dem Erhalt von WhatsApp-Nachrichten zugestimmt haben.</li>
  <li>Die App kann einer Person nur <b>innerhalb von 24 Stunden</b> nach deren letzter Nachricht frei schreiben. Danach bleibt die Nachricht in der App und wird als „nicht zugestellt“ markiert, bis die Person wieder schreibt (oder eine Vorlage eingerichtet ist).</li>
  <li>Bilder, Sprachnachrichten und Dokumente aus WhatsApp erscheinen als Hinweis; Anhänge aus der App werden nicht übertragen.</li></ul></div>`;

export async function openWhatsAppManager(chat, onChange) {
  const { el } = openModal(`<h3 class="mb-1 text-lg font-bold">💬 WhatsApp verbinden</h3>
    <p class="mb-3 text-sm text-slate-500">Chat: <b>${esc(chat.title || chat.name || 'Chat')}</b>. Nachrichten gehen in beide Richtungen; mehrere Nummern ergeben einen Verteiler („Gruppe“).</p>
    <div id="list" class="mb-3 space-y-1.5"><p class="text-sm text-slate-400">Lade…</p></div>
    <form id="f" class="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input name="name" class="input" placeholder="Name" required maxlength="80"><input name="phone" class="input" placeholder="+49 151 2345678" inputmode="tel" required><button class="btn-primary">Hinzufügen</button></form>
    ${HINT}<button data-close class="btn-ghost mt-3 w-full">Schließen</button>`, { wide: true });
  const draw = async () => {
    const box = el.querySelector('#list');
    try {
      const rows = unwrap(await supabase.from('whatsapp_contacts').select('*').eq('chat_id', chat.id).order('created_at'));
      box.innerHTML = rows.length ? rows.map((c) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5 text-sm"><span class="min-w-0"><b class="block truncate">${esc(c.name || 'Ohne Namen')}</b><span class="text-xs text-slate-500">${esc(prettyPhone(c.phone))}${c.last_inbound_at ? ' · zuletzt geschrieben ' + fmtDateTime(c.last_inbound_at) : ' · hat noch nicht geschrieben'}</span></span><button data-rm="${esc(c.id)}" class="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs !text-red-600">Trennen</button></div>`).join('')
        : '<p class="rounded-xl bg-slate-50 p-3 text-center text-sm italic text-slate-400">Noch keine Rufnummer verbunden.</p>';
      box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { if (confirm('Diese Rufnummer vom Chat trennen?')) busy(b, async () => { unwrap(await supabase.rpc('whatsapp_remove_contact', { p_id: b.dataset.rm })); toast('Getrennt', 'success'); await draw(); onChange?.(); }); }));
    } catch (e) { box.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p><p class="text-xs text-slate-500">Migration 009 eingespielt?</p>`; }
  };
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const n = normalizePhone(f.get('phone'));
    if (!n.ok) return toast(n.error, 'error');
    busy(e.target.querySelector('button'), async () => {
      unwrap(await supabase.rpc('whatsapp_add_contact', { p_chat: chat.id, p_name: f.get('name'), p_phone: f.get('phone') }));
      e.target.reset(); toast('Verbunden', 'success'); await draw(); onChange?.();
    });
  };
  draw();
}

export function openNewWhatsAppChat(onCreated) {
  const { el, close } = openModal(`<h3 class="mb-1 text-lg font-bold">💬 Neuer WhatsApp-Chat</h3>
    <p class="mb-3 text-sm text-slate-500">Legt einen App-Chat an und verbindet ihn mit einer WhatsApp-Nummer. Weitere Nummern lassen sich danach hinzufügen.</p>
    <form id="f" class="space-y-3"><div><label class="label">Chat-Name</label><input name="name" class="input" placeholder="z. B. Gemeinde-Helfer" required maxlength="60"></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Name der Person</label><input name="cname" class="input" required maxlength="80"></div><div><label class="label">WhatsApp-Nummer</label><input name="phone" class="input" placeholder="+49 151 2345678" inputmode="tel" required></div></div>
      ${HINT}<div class="flex justify-end gap-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Anlegen</button></div></form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const n = normalizePhone(f.get('phone'));
    if (!n.ok) return toast(n.error, 'error');
    busy(e.target.querySelector('.btn-primary'), async () => {
      const id = unwrap(await supabase.rpc('whatsapp_create_chat', { p_name: f.get('name'), p_contact_name: f.get('cname'), p_phone: f.get('phone') }));
      close(); toast('WhatsApp-Chat angelegt', 'success'); onCreated?.(id);
    });
  };
}
