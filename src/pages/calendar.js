import { supabase, unwrap } from '../lib/supabase.js';
import { esc, fmtDateTime, toast, openModal, busy } from '../lib/ui.js';
import { state, isManager } from '../state.js';
import { roomColor, startOfWeek, addDays, isoWeek, overlaps, viewRange, dayLabel } from '../lib/calendar.js';
import { buildIcs, rentalToEvent } from '../../supabase/functions/_shared/ics.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const VIEWS = [['month', 'Monat'], ['week', 'Woche'], ['list', 'Liste']];

// Ansicht merkt sich das Gerät (auch über Einstellungen → App wählbar)
export const getView = () => { try { return localStorage.getItem('cal_view') || 'month'; } catch { return 'month'; } };
const setView = (v) => { try { localStorage.setItem('cal_view', v); } catch { /* egal */ } };

export async function render(el, opts = {}) {
  const cal = { mine: !!opts.mine, view: opts.mine ? 'month' : getView(), anchor: new Date(), room: '', item: '', showReturned: false, events: [], items: [] };
  if (!cal.mine) {
    try { cal.items = unwrap(await supabase.from('items').select('id, name, room_id').order('name').limit(1000)); } catch (e) { toast(e.message, 'error'); }
  }
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2">
      ${cal.mine ? '<span class="mr-auto"></span>' : '<h1 class="mr-auto text-2xl font-bold">Kalender</h1>'}
      ${cal.mine ? '' : `<div id="viewSeg" class="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold">${VIEWS.map(([v, l]) => `<button data-view="${v}" class="rounded-lg px-3 py-1.5">${l}</button>`).join('')}</div>
      <button id="sub" class="btn-ghost !py-1.5 !text-xs">🔗 Abonnieren</button>`}
    </div>
    ${cal.mine ? '' : `<div class="mb-3 flex flex-wrap items-center gap-2">
      <select id="fRoom" class="input !w-auto !py-1.5 text-xs"><option value="">Alle Räume</option>${state.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
      <select id="fItem" class="input !w-auto max-w-[14rem] !py-1.5 text-xs"></select>
      <label class="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" id="fRet"> Rückgaben zeigen</label></div>`}
    ${cal.mine ? '<label class="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" id="fRet"> Rückgaben zeigen</label>' : ''}
    <div class="card !p-3">
      <div class="mb-3 flex items-center justify-between">
        <button id="prev" class="btn-ghost" aria-label="Zurück">←</button>
        <div class="text-center"><div id="title" class="font-bold"></div><button id="today" class="text-xs font-semibold text-brand-600">Heute</button></div>
        <button id="next" class="btn-ghost" aria-label="Weiter">→</button>
      </div>
      <div id="grid"></div>
    </div>
    <div class="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
      ${state.rooms.map((r) => `<span class="inline-flex items-center gap-1"><i class="inline-block h-2.5 w-2.5 rounded" style="background:${roomColor(r.id, state.rooms)}"></i>${esc(r.name)}</span>`).join('')}
      <span class="inline-flex items-center gap-1"><i class="inline-block h-2.5 w-2.5 rounded border-2 border-red-600"></i>Überfällig</span>
      <span class="inline-flex items-center gap-1"><i class="inline-block h-2.5 w-2.5 rounded bg-slate-400 opacity-60"></i>Belegt (Details nicht sichtbar)</span>
    </div>`;

  const fillItems = () => {
    const sel = el.querySelector('#fItem'); if (!sel) return;
    const opts2 = cal.items.filter((i) => !cal.room || i.room_id === cal.room);
    sel.innerHTML = `<option value="">Alle Artikel</option>${opts2.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}`;
    sel.value = cal.item;
  };
  const markView = () => el.querySelectorAll('[data-view]').forEach((b) => (b.className = `rounded-lg px-3 py-1.5 ${b.dataset.view === cal.view ? 'bg-brand-600 text-white' : 'text-slate-600'}`));
  fillItems(); markView();
  const reload = () => load(el, cal);
  el.querySelector('#fRoom')?.addEventListener('change', (e) => { cal.room = e.target.value; cal.item = ''; fillItems(); reload(); });
  el.querySelector('#fItem')?.addEventListener('change', (e) => { cal.item = e.target.value; reload(); });
  el.querySelector('#fRet').onchange = (e) => { cal.showReturned = e.target.checked; reload(); };
  el.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { cal.view = b.dataset.view; setView(cal.view); markView(); reload(); }));
  el.querySelector('#sub')?.addEventListener('click', openSubscribe);
  const shift = (d) => {
    const a = new Date(cal.anchor);
    if (cal.view === 'week') cal.anchor = addDays(a, 7 * d);
    else { a.setDate(1); a.setMonth(a.getMonth() + d); cal.anchor = a; }
    reload();
  };
  el.querySelector('#prev').onclick = () => shift(-1);
  el.querySelector('#next').onclick = () => shift(1);
  el.querySelector('#today').onclick = () => { cal.anchor = new Date(); reload(); };
  reload();
}

async function load(el, cal) {
  const { from, to } = viewRange(cal.view, cal.anchor);
  const title = el.querySelector('#title');
  if (cal.view === 'week') {
    const last = addDays(from, 6);
    title.textContent = `KW ${isoWeek(from)} · ${from.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${last.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  } else title.textContent = `${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  try {
    let q = supabase.from('rental_calendar').select('*').lt('start_at', to.toISOString()).gt('end_at', from.toISOString());
    q = cal.showReturned ? q.in('status', ['active', 'returned']) : q.eq('status', 'active');
    if (cal.room) q = q.eq('room_id', cal.room);
    if (cal.item) q = q.eq('item_id', cal.item);
    if (cal.mine) q = q.eq('borrower_id', state.user.id);
    cal.events = unwrap(await q.order('start_at').limit(2000));
  } catch (e) { toast(e.message, 'error'); cal.events = []; }
  const grid = el.querySelector('#grid');
  if (cal.view === 'week') drawWeek(grid, cal, from);
  else if (cal.view === 'list') drawList(grid, cal);
  else drawMonth(grid, cal, from);
  grid.querySelectorAll('[data-ev]').forEach((b) => (b.onclick = () => detail(cal.events.find((e) => e.id === b.dataset.ev))));
}

// Farbe nach Raum; Status über Rahmen/Deckkraft, damit beides gleichzeitig erkennbar ist
function chipStyle(e) {
  if (e.status === 'returned') return { cls: 'bg-slate-300 !text-slate-700 line-through', style: '' };
  const bg = roomColor(e.room_id, state.rooms);
  return {
    cls: `${e.overdue ? 'ring-2 ring-red-600 ring-inset' : ''} ${e.borrower_id ? '' : 'opacity-60'}`,
    style: `background:${bg}`,
  };
}
const chip = (e, text, extra = '') => {
  const s = chipStyle(e);
  return `<button data-ev="${esc(e.id)}" style="${s.style}" class="mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold text-white ${s.cls} ${extra}" title="${esc(e.item_name)}">${e.overdue ? '⚠ ' : ''}${text}</button>`;
};

function drawMonth(grid, cal, first) {
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  const todayStr = new Date().toDateString();
  let html = `<div class="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs">
    ${WEEKDAYS.map((d) => `<div class="bg-slate-50 py-1.5 text-center font-bold text-slate-500">${d}</div>`).join('')}`;
  for (let c = 0; c < cells; c++) {
    const dayNum = c - offset + 1;
    if (dayNum < 1 || dayNum > days) { html += '<div class="min-h-[4.5rem] bg-slate-50/60"></div>'; continue; }
    const d0 = new Date(first.getFullYear(), first.getMonth(), dayNum); const d1 = addDays(d0, 1);
    const evs = cal.events.filter((e) => overlaps(e, d0, d1));
    const isToday = d0.toDateString() === todayStr;
    html += `<div class="min-h-[4.5rem] bg-white p-1 md:min-h-[6rem]">
      <div class="mb-0.5 text-right"><span class="${isToday ? 'rounded-full bg-brand-600 px-1.5 py-0.5 font-bold text-white' : 'text-slate-500'}">${dayNum}</span></div>
      ${evs.slice(0, 3).map((e) => chip(e, esc(e.item_name))).join('')}
      ${evs.length > 3 ? `<div class="text-[10px] font-semibold text-slate-400">+${evs.length - 3} weitere</div>` : ''}
    </div>`;
  }
  grid.innerHTML = html + '</div>';
}

function drawWeek(grid, cal, monday) {
  const todayStr = new Date().toDateString();
  const cols = Array.from({ length: 7 }, (_, i) => {
    const d0 = addDays(monday, i); const d1 = addDays(d0, 1);
    const evs = cal.events.filter((e) => overlaps(e, d0, d1));
    const isToday = d0.toDateString() === todayStr;
    return `<div class="min-w-0 bg-white p-1.5 md:min-h-[14rem]">
      <div class="mb-1 flex items-baseline justify-between gap-1 border-b border-slate-100 pb-1"><b class="text-xs ${isToday ? 'text-brand-600' : 'text-slate-500'}">${WEEKDAYS[i]}</b><span class="text-[11px] ${isToday ? 'rounded-full bg-brand-600 px-1.5 font-bold text-white' : 'text-slate-400'}">${d0.getDate()}.${d0.getMonth() + 1}.</span></div>
      ${evs.length ? evs.map((e) => chip(e, `<span class="block truncate">${esc(e.item_name)}</span><span class="block font-normal opacity-90">${esc(dayLabel(e, d0))}${e.borrower_name ? ' · ' + esc(e.borrower_name) : ''}</span>`, '!py-1')).join('') : '<p class="text-center text-[10px] text-slate-300">–</p>'}
    </div>`;
  }).join('');
  grid.innerHTML = `<div class="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-7">${cols}</div>`;
}

function drawList(grid, cal) {
  if (!cal.events.length) { grid.innerHTML = '<p class="py-8 text-center text-sm italic text-slate-400">Keine Buchungen in diesem Monat.</p>'; return; }
  grid.innerHTML = `<div class="space-y-1.5">${cal.events.map((e) => {
    const s = chipStyle(e);
    return `<button data-ev="${esc(e.id)}" class="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left text-sm hover:border-brand-500">
      <i class="h-9 w-1.5 shrink-0 rounded ${e.overdue ? 'ring-2 ring-red-600' : ''}" style="${s.style || 'background:#cbd5e1'}"></i>
      <span class="min-w-0 flex-1"><b class="block truncate">${e.overdue ? '⚠ ' : ''}${esc(e.item_name)}</b><span class="text-xs text-slate-500">${fmtDateTime(e.start_at)} – ${fmtDateTime(e.end_at)}${e.borrower_name ? ' · ' + esc(e.borrower_name) : ''}${e.project ? ' · ' + esc(e.project) : ''}</span></span>
      <span class="hidden shrink-0 text-xs text-slate-400 sm:block">${esc(e.room_id)}</span></button>`;
  }).join('')}</div>`;
}

// ----- Einzelner Termin: Google Kalender & .ics -----
const gDate = (iso) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, '');
function googleUrl(e) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: `Ausleihe: ${e.item_name}`, dates: `${gDate(e.start_at)}/${gDate(e.end_at)}`, details: e.project ? `Projekt: ${e.project}` : 'Lagerverwaltung Pro' });
  return `https://calendar.google.com/calendar/render?${p}`;
}
function downloadIcs(e) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buildIcs([rentalToEvent({ ...e, own: true })])], { type: 'text/calendar;charset=utf-8' }));
  a.download = `ausleihe_${e.item_id}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
}

function detail(e) {
  if (!e) return;
  const { el } = openModal(`
    <div class="mb-3"><div class="text-xs font-bold uppercase text-slate-400">${e.overdue ? 'Überfällig' : e.status === 'returned' ? 'Zurückgegeben' : 'Aktive Buchung'}</div>
      <h3 class="text-lg font-bold">${esc(e.item_name)}</h3>
      <span class="badge text-white" style="background:${roomColor(e.room_id, state.rooms)}">${esc(e.room_id)}</span></div>
    <div class="space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
      <div class="flex justify-between"><span class="text-slate-400">Ausleiher</span><b>${esc(e.borrower_name || 'nicht sichtbar')}</b></div>
      <div class="flex justify-between"><span class="text-slate-400">Projekt</span><b>${esc(e.project || '–')}</b></div>
      <div class="flex justify-between"><span class="text-slate-400">Zeitraum</span><b class="text-right">${fmtDateTime(e.start_at)}<br>bis ${fmtDateTime(e.end_at)}</b></div>
    </div>
    <div class="mt-3 space-y-2">
      <a href="${esc(googleUrl(e))}" target="_blank" rel="noopener" class="btn-primary w-full">📅 In Google Kalender eintragen</a>
      <button id="ics" class="btn-ghost w-full">📥 .ics herunterladen</button>
      <button data-close class="btn-ghost w-full">Schließen</button>
    </div>`);
  el.querySelector('#ics').onclick = () => downloadIcs(e);
}

// ----- Abonnierbarer Kalender (aktualisiert sich selbst) -----
export async function openSubscribe() {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const { el } = openModal(`<h3 class="mb-1 text-lg font-bold">🔗 Kalender abonnieren</h3>
    <p class="mb-3 text-sm text-slate-500">Deine Ausleihen${isManager() ? ' und alle Buchungen deiner Räume' : ''} erscheinen automatisch in Google Kalender, Outlook oder auf dem iPhone. Der Kalender aktualisiert sich selbst (je nach Anbieter alle paar Stunden).</p>
    <div id="body"><p class="text-sm text-slate-400">Lade…</p></div>`);
  const draw = async (reset = false) => {
    const box = el.querySelector('#body');
    try {
      const token = unwrap(await supabase.rpc('calendar_feed_token', { p_reset: reset }));
      const https = `${base}/functions/v1/calendar-feed?token=${token}`;
      const webcal = https.replace(/^https?:/, 'webcal:');
      box.innerHTML = `
        <label class="label">Persönlicher Link (geheim halten)</label>
        <div class="mb-3 flex gap-2"><input id="lnk" class="input font-mono text-xs" readonly value="${esc(https)}"><button id="copy" class="btn-ghost shrink-0">Kopieren</button></div>
        <div class="grid gap-2">
          <a class="btn-primary" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}">Google Kalender</a>
          <a class="btn-ghost" target="_blank" rel="noopener" href="https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent('Lager Pro')}">Outlook</a>
          <a class="btn-ghost" href="${esc(webcal)}">Apple Kalender / iPhone</a>
        </div>
        <p class="mt-3 text-xs text-slate-500">Outlook Desktop: Kalender → „Kalender hinzufügen" → „Aus dem Internet" → Link einfügen.</p>
        <button id="reset" class="mt-3 w-full text-center text-xs font-semibold text-red-600 hover:underline">Link zurücksetzen (alter Link funktioniert dann nicht mehr)</button>`;
      box.querySelector('#copy').onclick = async () => { try { await navigator.clipboard.writeText(https); toast('Link kopiert', 'success'); } catch { box.querySelector('#lnk').select(); } };
      box.querySelector('#reset').onclick = (e) => { if (confirm('Link wirklich zurücksetzen? Bestehende Abos hören dann auf zu funktionieren.')) busy(e.target, () => draw(true)); };
    } catch (e) {
      box.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p><p class="mt-1 text-xs text-slate-500">Hinweis für Admins: Migration 007 einspielen und die Edge Function „calendar-feed" deployen.</p>`;
    }
  };
  draw();
}
