import { displayName } from '../lib/format.js';
import QRCode from 'qrcode';
import { supabase, unwrap, safeData } from '../lib/supabase.js';
import { esc, fmtDateTime, toast, busy, openModal } from '../lib/ui.js';
import { state } from '../state.js';
import * as calendar from './calendar.js';
import { openExtend } from '../components/extendModal.js';
import { uploadDamagePhoto, removeDamagePhotos } from '../lib/photos.js';
import { collapsible, bindCollapsibles, setCount } from '../components/collapse.js';
import { emptyState } from '../components/emptyState.js';

const MAX_DAMAGE = 5;

export async function render(el) {
  const p = state.profile;
  el.innerHTML = `
    <h1 class="mb-3 text-2xl font-bold">Mein Bereich</h1>
    <section class="card mb-3 flex items-center gap-3">
      <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-700 text-lg font-bold text-white">${esc((displayName(p))[0]?.toUpperCase())}</div>
      <div class="min-w-0 flex-1"><div class="truncate font-bold">${esc(p.full_name)}</div><div class="truncate text-xs text-slate-500">@${esc(p.username)} · ${esc(p.email)}</div></div>
      <button id="qrBtn" class="btn-ghost shrink-0">📱 Mein QR-Code</button>
    </section>
    <div class="space-y-3">
      ${collapsible({ id: 'me-rentals', title: '📦 Aktuelle Leihen', count: '…', open: true, body: '<div id="rentals" class="space-y-2 text-sm"><p class="text-slate-400">Lade…</p></div>' })}
      ${collapsible({ id: 'me-cal', title: '📅 Mein Kalender', hint: 'Deine Buchungen im Monatsüberblick', body: '<div id="myCal"></div>' })}
      ${collapsible({ id: 'me-wait', title: '🔔 Meine Warteliste', count: '…', body: '<div id="wait" class="space-y-2 text-sm"></div>' })}
      ${collapsible({ id: 'me-log', title: '🧾 Protokoll', hint: 'Deine letzten Aktivitäten', count: '…', body: '<div id="log" class="space-y-1.5 text-xs"><p class="text-slate-400">Lade…</p></div>' })}
    </div>`;
  bindCollapsibles(el);
  el.querySelector('#qrBtn').onclick = async () => {
    const url = await QRCode.toDataURL(`USER:${p.id}`, { width: 360, margin: 1 });
    openModal(`<div class="text-center"><h3 class="mb-1 text-lg font-bold">${esc(p.full_name)}</h3><p class="mb-3 text-xs text-slate-500">Am Lagerterminal vorzeigen</p><img src="${url}" alt="Benutzer-QR" class="mx-auto h-64 w-64 rounded-xl border"><button data-close class="btn-ghost mt-4 w-full">Schließen</button></div>`);
  };
  load(el);
  calendar.render(el.querySelector('#myCal'), { mine: true });
}

async function load(el) {
  try {
    const rentals = unwrap(await supabase.from('rentals').select('id, item_id, start_at, end_at, project, items(name, accessories, room_id)')
      .eq('borrower_id', state.user.id).eq('status', 'active').order('end_at'));
    const pending = await safeData(supabase.from('extension_requests').select('id, rental_id, new_end_at').eq('requested_by', state.user.id).eq('status', 'pending'));
    const pend = Object.fromEntries(pending.map((p) => [p.rental_id, p]));
    const small = '!px-2.5 !py-1 !text-xs';
    const lateN = rentals.filter((r) => new Date(r.end_at) < new Date()).length;
    setCount(el, 'me-rentals', rentals.length, lateN ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600');
    el.querySelector('#rentals').innerHTML = rentals.length ? rentals.map((r) => {
      const late = new Date(r.end_at) < new Date(); const p = pend[r.id];
      return `<div class="rounded-xl border p-2.5 ${late ? 'border-red-300 bg-red-50' : 'bg-slate-50'}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div><b>${esc(r.items?.name)}</b>${late ? ' <span class="badge bg-red-600 text-white">Überfällig</span>' : ''}<div class="text-xs text-slate-500">${fmtDateTime(r.start_at)} – ${fmtDateTime(r.end_at)}${r.project ? ' · ' + esc(r.project) : ''}</div></div>
          <div class="flex flex-wrap items-center gap-1.5">
            ${p ? `<span class="badge bg-amber-100 text-amber-800">Antrag offen bis ${fmtDateTime(p.new_end_at)}</span><button data-cancel="${esc(p.id)}" class="btn-ghost ${small}">Zurückziehen</button>` : `<button data-ext="${esc(r.id)}" class="btn-ghost ${small}">Verlängern</button>`}
            <button data-ret="${esc(r.id)}" class="btn-primary ${small}">Zurückgeben</button></div></div></div>`;
    }).join('') : emptyState({ icon: '📦', title: 'Gerade nichts ausgeliehen', text: 'Sobald du etwas ausleihst, erscheint es hier – mit Frist, Rückgabe- und Verlängern-Knopf.', actions: [{ id: 'go', label: 'Zum Katalog', primary: true }] });
    el.querySelector('[data-empty="go"]')?.addEventListener('click', () => { location.hash = '#/katalog'; });
    el.querySelectorAll('[data-ret]').forEach((b) => (b.onclick = () => returnModal(rentals.find((r) => r.id === b.dataset.ret), () => load(el))));
    el.querySelectorAll('[data-ext]').forEach((b) => (b.onclick = () => openExtend(rentals.find((r) => r.id === b.dataset.ext), () => load(el))));
    el.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => busy(b, async () => { unwrap(await supabase.rpc('cancel_extension_request', { p_request_id: b.dataset.cancel })); toast('Antrag zurückgezogen', 'success'); load(el); })));

    const wait = await safeData(supabase.from('waitlist').select('item_id, items(name)').order('created_at'));
    setCount(el, 'me-wait', wait.length);
    el.querySelector('#wait').innerHTML = wait.length ? wait.map((w) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5"><span><b>${esc(w.items?.name)}</b> <span class="font-mono text-xs text-slate-400">${esc(w.item_id)}</span></span><button data-leave="${esc(w.item_id)}" class="btn-ghost ${small}">Abbestellen</button></div>`).join('')
      : '<p class="italic text-slate-400">Keine Benachrichtigungen aktiv. Im Katalog kannst du dich bei belegten Artikeln benachrichtigen lassen.</p>';
    el.querySelectorAll('[data-leave]').forEach((b) => (b.onclick = () => busy(b, async () => { unwrap(await supabase.rpc('leave_waitlist', { p_item_id: b.dataset.leave })); load(el); })));

    const log = unwrap(await supabase.from('activity_log').select('*').or(`actor_id.eq.${state.user.id},subject_id.eq.${state.user.id}`)
      .order('created_at', { ascending: false }).limit(30));
    setCount(el, 'me-log', log.length);
    el.querySelector('#log').innerHTML = log.length ? log.map((l) => `<div class="flex justify-between gap-2 border-b border-slate-100 pb-1"><span><b class="text-brand-700">[${esc(l.action)}]</b> ${esc(l.item_name || '')}</span><span class="shrink-0 text-slate-400">${fmtDateTime(l.created_at)}</span></div>`).join('')
      : '<p class="italic text-slate-400">Noch keine Aktivitäten.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

export function returnModal(rental, reload) {
  const acc = rental.items?.accessories || [];
  const photos = []; // { file, url }
  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">Rückgabe: ${esc(rental.items?.name)}</h3>
    <p class="mb-3 text-xs text-slate-500">Bitte Vollständigkeit prüfen.</p>
    <form id="f" class="space-y-3">
      ${acc.length ? `<div class="rounded-xl bg-slate-50 p-3 text-sm">${acc.map((a) => `<label class="flex items-center gap-2"><input type="checkbox" checked> ${esc(a)}</label>`).join('')}</div>` : ''}
      <div><label class="label">Bemerkung</label><textarea name="note" class="input h-16"></textarea></div>
      <label class="flex items-center gap-2 text-sm font-semibold text-red-600"><input type="checkbox" id="dmg"> Defekt / Schaden melden</label>
      <div id="dmgBox" class="hidden space-y-2">
        <textarea name="damage" id="dmgText" class="input h-20" placeholder="Beschreibung des Defekts…"></textarea>
        <div class="flex flex-wrap items-center gap-2" id="thumbs"></div>
        <label class="btn-ghost w-full cursor-pointer">📷 Schadensfoto hinzufügen (max. ${MAX_DAMAGE})<input id="dmgFiles" type="file" accept="image/*" capture="environment" multiple class="hidden"></label>
      </div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Rückgabe bestätigen</button></div>
    </form>`);
  const drawThumbs = () => {
    el.querySelector('#thumbs').innerHTML = photos.map((p, i) => `<div class="relative"><img src="${esc(p.url)}" alt="" class="h-16 w-16 rounded-xl object-cover"><button type="button" data-rm="${i}" class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white">✕</button></div>`).join('');
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { URL.revokeObjectURL(photos[b.dataset.rm].url); photos.splice(Number(b.dataset.rm), 1); drawThumbs(); }));
  };
  el.querySelector('#dmg').onchange = (e) => { el.querySelector('#dmgBox').classList.toggle('hidden', !e.target.checked); el.querySelector('#dmgText').required = e.target.checked; };
  el.querySelector('#dmgFiles').onchange = (e) => {
    const files = [...e.target.files]; e.target.value = '';
    const room = MAX_DAMAGE - photos.length;
    if (files.length > room) toast(`Höchstens ${MAX_DAMAGE} Fotos – ${files.length - room} ignoriert.`, 'info');
    files.slice(0, room).forEach((file) => photos.push({ file, url: URL.createObjectURL(file) }));
    drawThumbs();
  };
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const damaged = el.querySelector('#dmg').checked;
    const btn = e.target.querySelector('.btn-primary');
    busy(btn, async () => {
      const urls = [];
      try {
        if (damaged) {
          for (const [i, p] of photos.entries()) { btn.textContent = `Foto ${i + 1}/${photos.length} wird hochgeladen…`; urls.push(await uploadDamagePhoto(state.user.id, p.file)); }
        }
        btn.textContent = 'Rückgabe wird gebucht…';
        unwrap(await supabase.rpc('return_rentals', {
          p_rental_ids: [rental.id], p_note: f.get('note'), p_damage: damaged ? f.get('damage') : null, p_damage_photos: urls,
        }));
      } catch (err) {
        await removeDamagePhotos(urls); // keine verwaisten Fotos zurücklassen
        btn.textContent = 'Rückgabe bestätigen';
        throw err;
      }
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      close(); toast(urls.length ? `Rückgabe mit ${urls.length} Foto(s) verbucht` : 'Rückgabe verbucht', 'success'); reload();
    });
  };
}
