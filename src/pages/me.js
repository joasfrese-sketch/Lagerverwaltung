import QRCode from 'qrcode';
import { supabase, unwrap } from '../lib/supabase.js';
import { esc, fmtDateTime, toast, busy, openModal } from '../lib/ui.js';
import { state } from '../state.js';
import * as calendar from './calendar.js';

export async function render(el) {
  const p = state.profile;
  el.innerHTML = `
    <h1 class="mb-4 text-2xl font-bold">Mein Bereich</h1>
    <div class="grid gap-4 md:grid-cols-3">
      <section class="card text-center">
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-xl font-bold text-white">${esc((p.full_name || p.username)[0]?.toUpperCase())}</div>
        <div class="mt-2 font-bold">${esc(p.full_name)}</div><div class="text-xs text-slate-500">@${esc(p.username)} · ${esc(p.email)}</div>
        <img id="qr" alt="Benutzer-QR" class="mx-auto mt-3 h-40 w-40 rounded-xl border"><div class="mt-1 text-[11px] text-slate-400">Am Lagerterminal vorzeigen</div>
      </section>
      <div class="space-y-4 md:col-span-2">
        <section class="card"><h2 class="mb-2 text-sm font-bold">📦 Aktuelle Leihen</h2><div id="rentals" class="space-y-2 text-sm"><p class="text-slate-400">Lade…</p></div></section>
        <section class="card"><h2 class="mb-2 text-sm font-bold">📅 Mein Kalender</h2><div id="myCal"></div></section>
        <section class="card"><h2 class="mb-2 text-sm font-bold">🧾 Protokoll</h2><div id="log" class="space-y-1.5 text-xs"><p class="text-slate-400">Lade…</p></div></section>
      </div>
    </div>`;
  QRCode.toDataURL(`USER:${p.id}`, { width: 320, margin: 1 }).then((u) => (el.querySelector('#qr').src = u));
  load(el);
  calendar.render(el.querySelector('#myCal'), { mine: true });
}

async function load(el) {
  try {
    const rentals = unwrap(await supabase.from('rentals').select('id, item_id, start_at, end_at, project, items(name, accessories)')
      .eq('borrower_id', state.user.id).eq('status', 'active').order('end_at'));
    el.querySelector('#rentals').innerHTML = rentals.length ? rentals.map((r) => {
      const late = new Date(r.end_at) < new Date();
      return `<div class="flex items-center justify-between rounded-xl border p-2.5 ${late ? 'border-red-300 bg-red-50' : 'bg-slate-50'}">
        <div><b>${esc(r.items?.name)}</b>${late ? ' <span class="badge bg-red-600 text-white">Überfällig</span>' : ''}<div class="text-xs text-slate-500">${fmtDateTime(r.start_at)} – ${fmtDateTime(r.end_at)}${r.project ? ' · ' + esc(r.project) : ''}</div></div>
        <button data-ret="${esc(r.id)}" class="btn-primary !px-2.5 !py-1 !text-xs">Zurückgeben</button></div>`;
    }).join('') : '<p class="italic text-slate-400">Keine aktiven Ausleihen.</p>';
    el.querySelectorAll('[data-ret]').forEach((b) => (b.onclick = () => returnModal(rentals.find((r) => r.id === b.dataset.ret), () => load(el))));

    const log = unwrap(await supabase.from('activity_log').select('*').or(`actor_id.eq.${state.user.id},subject_id.eq.${state.user.id}`)
      .order('created_at', { ascending: false }).limit(30));
    el.querySelector('#log').innerHTML = log.length ? log.map((l) => `<div class="flex justify-between gap-2 border-b border-slate-100 pb-1"><span><b class="text-brand-600">[${esc(l.action)}]</b> ${esc(l.item_name || '')}</span><span class="shrink-0 text-slate-400">${fmtDateTime(l.created_at)}</span></div>`).join('')
      : '<p class="italic text-slate-400">Noch keine Aktivitäten.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

export function returnModal(rental, reload) {
  const acc = rental.items?.accessories || [];
  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">Rückgabe: ${esc(rental.items?.name)}</h3>
    <p class="mb-3 text-xs text-slate-500">Bitte Vollständigkeit prüfen.</p>
    <form id="f" class="space-y-3">
      ${acc.length ? `<div class="rounded-xl bg-slate-50 p-3 text-sm">${acc.map((a) => `<label class="flex items-center gap-2"><input type="checkbox" checked> ${esc(a)}</label>`).join('')}</div>` : ''}
      <div><label class="label">Bemerkung</label><textarea name="note" class="input h-16"></textarea></div>
      <label class="flex items-center gap-2 text-sm font-semibold text-red-600"><input type="checkbox" id="dmg"> Defekt / Schaden melden</label>
      <textarea name="damage" id="dmgText" class="input hidden h-20" placeholder="Beschreibung des Defekts…"></textarea>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Rückgabe bestätigen</button></div>
    </form>`);
  el.querySelector('#dmg').onchange = (e) => el.querySelector('#dmgText').classList.toggle('hidden', !e.target.checked);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      unwrap(await supabase.rpc('return_rentals', {
        p_rental_ids: [rental.id], p_note: f.get('note'), p_damage: el.querySelector('#dmg').checked ? f.get('damage') : null,
      }));
      close(); toast('Rückgabe verbucht', 'success'); reload();
    });
  };
}
