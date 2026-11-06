import { supabase, unwrap } from '../lib/supabase.js';
import { esc, fmtDateTime } from '../lib/ui.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const day = (d) => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const time = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// Mini-Kalender mit den Buchungen EINES Artikels. getRange() liefert den gewählten Zeitraum, onPickDay(date) wird beim Antippen eines Tages gerufen.
export async function mountItemCalendar(box, itemId, { getRange, onPickDay }) {
  const from = new Date(); from.setDate(from.getDate() - 35);
  let bookings = [];
  try {
    bookings = unwrap(await supabase.from('rental_calendar').select('id, start_at, end_at, borrower_name, project')
      .eq('item_id', itemId).eq('status', 'active').gte('end_at', from.toISOString()).order('start_at'));
  } catch { bookings = []; }
  const bk = bookings.map((b) => ({ ...b, s: new Date(b.start_at), e: new Date(b.end_at) }));
  const now = new Date();
  const view = { y: now.getFullYear(), m: now.getMonth() };

  box.innerHTML = `
    <div class="mb-1 flex items-center justify-between"><button type="button" data-nav="-1" class="btn-ghost !px-2.5 !py-1">←</button><b id="ttl" class="text-sm"></b><button type="button" data-nav="1" class="btn-ghost !px-2.5 !py-1">→</button></div>
    <div id="grid"></div>
    <div class="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500"><span><i class="inline-block h-2.5 w-2.5 rounded bg-red-200"></i> ganztägig belegt</span><span><i class="inline-block h-2.5 w-2.5 rounded bg-amber-200"></i> teilweise belegt</span><span><i class="inline-block h-2.5 w-2.5 rounded ring-2 ring-brand-500"></i> dein Zeitraum</span></div>
    <p class="mt-1 text-[11px] text-slate-400">Tippe zwei Tage an, um Beginn und Rückgabe zu setzen.</p>
    <div id="info" class="mt-2 space-y-1 text-xs"></div>`;
  box.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => {
    view.m += Number(b.dataset.nav);
    if (view.m < 0) { view.m = 11; view.y--; } else if (view.m > 11) { view.m = 0; view.y++; }
    draw();
  }));

  const conflicts = (start, end) => bk.filter((b) => start < b.e && end > b.s);
  const overdue = () => bk.some((b) => b.e < new Date());

  function draw() {
    box.querySelector('#ttl').textContent = `${MONTHS[view.m]} ${view.y}`;
    const first = new Date(view.y, view.m, 1); const offset = (first.getDay() + 6) % 7;
    const days = new Date(view.y, view.m + 1, 0).getDate(); const cells = Math.ceil((offset + days) / 7) * 7;
    const { start, end } = getRange();
    let html = `<div class="grid grid-cols-7 gap-1 text-center text-[11px]">${WD.map((d) => `<div class="font-bold text-slate-400">${d}</div>`).join('')}`;
    for (let c = 0; c < cells; c++) {
      const n = c - offset + 1;
      if (n < 1 || n > days) { html += '<div></div>'; continue; }
      const d0 = new Date(view.y, view.m, n); const d1 = new Date(view.y, view.m, n + 1);
      const evs = bk.filter((b) => b.s < d1 && b.e > d0);
      const full = evs.some((b) => b.s <= d0 && b.e >= d1);
      const inRange = start && end && start < d1 && end > d0;
      const past = d1 <= new Date();
      const cls = full ? 'bg-red-100 text-red-700 font-bold' : evs.length ? 'bg-amber-100 text-amber-800 font-semibold' : 'bg-slate-50 text-slate-700';
      html += `<button type="button" data-d="${d0.getTime()}" class="rounded-lg py-1.5 ${cls} ${inRange ? 'ring-2 ring-brand-500' : ''} ${past ? 'opacity-50' : ''}">${n}</button>`;
    }
    box.querySelector('#grid').innerHTML = html + '</div>';
    box.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => onPickDay(new Date(Number(b.dataset.d)))));

    const clash = start && end && end > start ? conflicts(start, end) : [];
    const upcoming = bk.filter((b) => b.e > new Date()).slice(0, 4);
    box.querySelector('#info').innerHTML =
      (overdue() ? '<p class="rounded-xl bg-red-50 p-2 font-semibold text-red-700">⚠️ Eine frühere Ausleihe ist überfällig und noch nicht zurückgegeben – Buchung nicht möglich.</p>' : '')
      + (clash.length ? `<p class="rounded-xl bg-red-50 p-2 font-semibold text-red-700">⚠️ Dein Zeitraum kollidiert mit: ${clash.map((b) => `${day(b.s)} ${time(b.s)} – ${day(b.e)} ${time(b.e)}`).join('; ')}</p>`
        : start && end && end > start ? '<p class="rounded-xl bg-emerald-50 p-2 font-semibold text-emerald-800">✅ Zeitraum ist frei</p>' : '')
      + (upcoming.length ? `<div class="rounded-xl bg-slate-50 p-2"><b class="text-slate-600">Belegungen:</b>${upcoming.map((b) => `<div>🔴 ${day(b.s)} ${time(b.s)} – ${day(b.e)} ${time(b.e)}${b.borrower_name ? ' · ' + esc(b.borrower_name) : ''}${b.project ? ' · ' + esc(b.project) : ''}</div>`).join('')}</div>` : '<p class="text-slate-400">Keine anstehenden Belegungen.</p>');
  }
  draw();
  return { refresh: draw, conflicts, overdue };
}
