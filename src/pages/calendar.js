import { supabase, unwrap } from '../lib/supabase.js';
import { esc, fmtDateTime, toast, openModal } from '../lib/ui.js';
import { state } from '../state.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Ansicht ist einstellbar (Einstellungen → Kalender). Bisher implementiert: 'month'.
const getView = () => localStorage.getItem('cal_view') || 'month';

const cal = { mine: false, year: new Date().getFullYear(), month: new Date().getMonth(), room: '', item: '', showReturned: false, events: [], items: [] };

export async function render(el, opts = {}) {
  cal.mine = !!opts.mine;
  cal.room = ''; cal.item = '';
  try { cal.items = unwrap(await supabase.from('items').select('id, name, room_id').order('name').limit(500)); } catch (e) { cal.items = []; toast(e.message, 'error'); }
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2">
      ${cal.mine ? '<span class="mr-auto"></span>' : '<h1 class="mr-auto text-2xl font-bold">Kalender</h1>'}
      <select id="fRoom" class="input !w-auto"><option value="">Alle Räume</option>${state.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
      <select id="fItem" class="input !w-auto max-w-[14rem]"></select>
      <label class="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" id="fRet"> Rückgaben zeigen</label>
    </div>
    <div class="card !p-3">
      <div class="mb-3 flex items-center justify-between">
        <button id="prev" class="btn-ghost">←</button>
        <div class="text-center"><div id="title" class="font-bold"></div><button id="today" class="text-xs font-semibold text-brand-600">Heute</button></div>
        <button id="next" class="btn-ghost">→</button>
      </div>
      <div id="grid"></div>
    </div>
    <div class="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
      <span><i class="inline-block h-2.5 w-2.5 rounded bg-brand-600"></i> Meine / verantwortete Buchungen</span>
      <span><i class="inline-block h-2.5 w-2.5 rounded bg-slate-400"></i> Belegt (Details nicht sichtbar)</span>
      <span><i class="inline-block h-2.5 w-2.5 rounded bg-red-600"></i> Überfällig</span>
    </div>`;

  const fillItems = () => {
    const opts = cal.items.filter((i) => !cal.room || i.room_id === cal.room);
    el.querySelector('#fItem').innerHTML = `<option value="">Alle Artikel</option>${opts.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}`;
    el.querySelector('#fItem').value = cal.item;
  };
  fillItems();
  const reload = () => load(el);
  el.querySelector('#fRoom').onchange = (e) => { cal.room = e.target.value; cal.item = ''; fillItems(); reload(); };
  el.querySelector('#fItem').onchange = (e) => { cal.item = e.target.value; reload(); };
  el.querySelector('#fRet').onchange = (e) => { cal.showReturned = e.target.checked; reload(); };
  const shift = (d) => { cal.month += d; if (cal.month < 0) { cal.month = 11; cal.year--; } if (cal.month > 11) { cal.month = 0; cal.year++; } reload(); };
  el.querySelector('#prev').onclick = () => shift(-1);
  el.querySelector('#next').onclick = () => shift(1);
  el.querySelector('#today').onclick = () => { cal.year = new Date().getFullYear(); cal.month = new Date().getMonth(); reload(); };
  reload();
}

async function load(el) {
  el.querySelector('#title').textContent = `${MONTHS[cal.month]} ${cal.year}`;
  const from = new Date(cal.year, cal.month, 1);
  const to = new Date(cal.year, cal.month + 1, 1);
  try {
    let q = supabase.from('rental_calendar').select('*').lt('start_at', to.toISOString()).gt('end_at', from.toISOString());
    q = cal.showReturned ? q.in('status', ['active', 'returned']) : q.eq('status', 'active');
    if (cal.room) q = q.eq('room_id', cal.room);
    if (cal.item) q = q.eq('item_id', cal.item);
    if (cal.mine) q = q.eq('borrower_id', state.user.id);
    cal.events = unwrap(await q.order('start_at'));
    drawMonth(el);
  } catch (e) { toast(e.message, 'error'); }
}

function drawMonth(el) {
  const first = new Date(cal.year, cal.month, 1);
  const offset = (first.getDay() + 6) % 7; // Montag = 0
  const days = new Date(cal.year, cal.month + 1, 0).getDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  const todayStr = new Date().toDateString();
  let html = `<div class="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-xs">
    ${WEEKDAYS.map((d) => `<div class="bg-slate-50 py-1.5 text-center font-bold text-slate-500">${d}</div>`).join('')}`;
  for (let c = 0; c < cells; c++) {
    const dayNum = c - offset + 1;
    if (dayNum < 1 || dayNum > days) { html += '<div class="min-h-[4.5rem] bg-slate-50/60"></div>'; continue; }
    const d0 = new Date(cal.year, cal.month, dayNum), d1 = new Date(cal.year, cal.month, dayNum + 1);
    const evs = cal.events.filter((e) => new Date(e.start_at) < d1 && new Date(e.end_at) > d0);
    const isToday = d0.toDateString() === todayStr;
    html += `<div class="min-h-[4.5rem] bg-white p-1 md:min-h-[6rem]">
      <div class="mb-0.5 text-right"><span class="${isToday ? 'rounded-full bg-brand-600 px-1.5 py-0.5 font-bold text-white' : 'text-slate-500'}">${dayNum}</span></div>
      ${evs.slice(0, 3).map((e) => `<button data-ev="${esc(e.id)}" class="mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold text-white ${color(e)}">${esc(e.item_name)}</button>`).join('')}
      ${evs.length > 3 ? `<div class="text-[10px] font-semibold text-slate-400">+${evs.length - 3} weitere</div>` : ''}
    </div>`;
  }
  html += '</div>';
  const grid = el.querySelector('#grid');
  grid.innerHTML = html;
  grid.querySelectorAll('[data-ev]').forEach((b) => (b.onclick = () => detail(cal.events.find((e) => e.id === b.dataset.ev))));
}

function color(e) {
  if (e.status === 'returned') return 'bg-slate-300 !text-slate-700';
  if (e.overdue) return 'bg-red-600';
  return e.borrower_id ? 'bg-brand-600' : 'bg-slate-400';
}

// ----- Export: Google Kalender & .ics -----
const gDate = (iso) => new Date(iso).toISOString().replace(/[-:]|\.\d{3}/g, '');
const icsEsc = (s) => String(s ?? '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');

function googleUrl(e) {
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: `Ausleihe: ${e.item_name}`, dates: `${gDate(e.start_at)}/${gDate(e.end_at)}`,
    details: e.project ? `Projekt: ${e.project}` : 'Lagerverwaltung Pro',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function downloadIcs(e) {
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lagerverwaltung Pro//DE', 'BEGIN:VEVENT',
    `UID:${e.id}@lagerverwaltung`, `DTSTAMP:${gDate(new Date().toISOString())}`,
    `DTSTART:${gDate(e.start_at)}`, `DTEND:${gDate(e.end_at)}`,
    `SUMMARY:${icsEsc('Ausleihe: ' + e.item_name)}`, `DESCRIPTION:${icsEsc(e.project || '')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = `ausleihe_${e.item_id}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
}

function detail(e) {
  const { el } = openModal(`
    <div class="mb-3"><div class="text-xs font-bold uppercase text-slate-400">${e.overdue ? 'Überfällig' : e.status === 'returned' ? 'Zurückgegeben' : 'Aktive Buchung'}</div>
      <h3 class="text-lg font-bold">${esc(e.item_name)}</h3></div>
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
