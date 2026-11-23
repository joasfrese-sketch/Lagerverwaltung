import { displayName } from '../lib/format.js';
import { esc, toast, openModal, busy, toLocalInput, fmtDateTime } from '../lib/ui.js';
import { state, canManageRoom, isManager } from '../state.js';
import { mountItemCalendar } from './itemCalendar.js';
import { defaultWindow, quickWindows, checkAvailability } from '../lib/rules.js';
import { getPref, setPref } from '../lib/prefs.js';
import * as data from '../lib/catalogData.js';

// Schnellwahl-Knöpfe für den Zeitraum: setzen Beginn und Rückgabe in einem Tipp
const quickButtons = () => `<div class="flex flex-wrap gap-1.5" id="quick">${quickWindows().map((w) => `<button type="button" data-q="${w.id}" class="btn-ghost !px-2.5 !py-1 !text-xs">${esc(w.label)}</button>`).join('')}</div>`;
function bindQuick(form, after) {
  form.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
    const w = quickWindows().find((x) => x.id === b.dataset.q); if (!w) return;
    form.elements.start.value = toLocalInput(w.start); form.elements.end.value = toLocalInput(w.end); after();
  }));
}
// Projekt wird für die nächste Ausleihe vorgeschlagen
const projectField = () => `<div><label class="label">Projekt / Einsatzort</label><input name="project" class="input" list="projHint" placeholder="optional" value="${esc(getPref('project'))}" maxlength="80"></div>`;

const borrowerSelect = (people) => `<div><label class="label">Ausleihen für</label><select name="borrower" class="input">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === (getPref('borrower') || state.user.id) ? 'selected' : ''}>${esc(displayName(p))} (@${esc(p.username)})</option>`).join('')}</select></div>`;

// Sammel-Ausleihe: mehrere Artikel mit gemeinsamem Zeitraum buchen (freie werden gebucht, belegte gemeldet)
export async function bulkRentModal(items, onDone) {
  const { start, end } = defaultWindow();
  const mgr = isManager();
  const people = mgr ? await data.people() : [];
  const bookings = await data.bookingsFor(items.map((i) => i.id));
  const { el, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">${items.length} Artikel ausleihen</h3>
    <div class="grid gap-5 md:grid-cols-2">
      <form id="f" class="space-y-3">
        ${mgr ? borrowerSelect(people) : ''}
        ${projectField()}
        ${quickButtons()}
        <div class="grid grid-cols-2 gap-2"><div><label class="label">Beginn</label><input type="datetime-local" name="start" step="900" value="${toLocalInput(start)}" class="input" required></div>
          <div><label class="label">Rückgabe</label><input type="datetime-local" name="end" step="900" value="${toLocalInput(end)}" class="input" required></div></div>
        <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button id="book" class="btn-primary">Buchen</button></div>
      </form>
      <div><h4 class="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Verfügbarkeit im Zeitraum</h4><div id="list" class="max-h-72 space-y-1.5 overflow-y-auto"></div></div>
    </div>`, { wide: true });
  const form = el.querySelector('#f'); const book = el.querySelector('#book');
  let free = [];
  const REASON = { overdue: 'überfällig, noch nicht zurückgegeben', invalid: 'Zeitraum ungültig' };
  const check = () => {
    const s = new Date(form.elements.start.value); const e = new Date(form.elements.end.value);
    free = [];
    el.querySelector('#list').innerHTML = items.map((i) => {
      const r = checkAvailability(bookings.filter((b) => b.id === i.id), s, e);
      if (r.ok) free.push(i.id);
      return `<div class="rounded-xl p-2 text-sm ${r.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">${r.ok ? '✅' : '❌'} <b>${esc(i.name)}</b><span class="block text-xs">${r.ok ? 'frei' : r.reason === 'clash' ? 'belegt: ' + r.clash.map((b) => fmtDateTime(b.s) + ' – ' + fmtDateTime(b.e)).join('; ') : REASON[r.reason]}</span></div>`;
    }).join('');
    book.textContent = free.length === items.length ? `${free.length} Artikel buchen` : `${free.length} von ${items.length} buchen`;
    book.disabled = !free.length;
  };
  form.elements.start.oninput = check; form.elements.end.oninput = check; bindQuick(form, check); check();
  form.onsubmit = (ev) => {
    ev.preventDefault(); const f = new FormData(ev.target);
    busy(book, async () => {
      const res = await data.rentItems({ p_item_ids: free, p_start: new Date(f.get('start')).toISOString(), p_end: new Date(f.get('end')).toISOString(), p_project: f.get('project'), p_borrower: f.get('borrower') || null });
      setPref('project', f.get('project')); if (f.get('borrower')) setPref('borrower', f.get('borrower'));
      const okIds = res.filter((r) => r.ok).map((r) => r.item_id); const bad = res.filter((r) => !r.ok);
      close();
      if (okIds.length) toast(`${okIds.length} Artikel gebucht`, 'success');
      if (bad.length) openModal(`<h3 class="mb-2 text-lg font-bold text-red-600">Nicht alle gebucht</h3><ul class="mb-3 space-y-1 text-sm">${bad.map((r) => `<li class="rounded-xl bg-red-50 p-2 text-red-700"><b>${esc(items.find((i) => i.id === r.item_id)?.name || r.item_id)}</b>: ${esc(r.error)}</li>`).join('')}</ul><button data-close class="btn-primary w-full">OK</button>`);
      onDone(okIds);
    });
  };
}

export async function rentModal(item, reload) {
  const { start, end } = defaultWindow();
  const people = canManageRoom(item.room_id) ? await data.people() : [];
  const { el, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">Ausleihe: ${esc(item.name)}</h3>
    <div class="grid gap-5 md:grid-cols-2">
      <form id="f" class="space-y-3">
        ${people.length ? borrowerSelect(people) : ''}
        ${projectField()}
        ${quickButtons()}
        <div class="grid grid-cols-2 gap-2">
          <div><label class="label">Beginn</label><input type="datetime-local" name="start" step="900" value="${toLocalInput(start)}" class="input" required></div>
          <div><label class="label">Rückgabe</label><input type="datetime-local" name="end" step="900" value="${toLocalInput(end)}" class="input" required></div>
        </div>
        <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button id="book" class="btn-primary">Verbindlich buchen</button></div>
      </form>
      <div><h4 class="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Belegungsplan dieses Artikels</h4><div id="cal"><p class="text-sm text-slate-400">Lade…</p></div></div>
    </div>`, { wide: true });
  const form = el.querySelector('#f'); const sIn = form.elements.start; const eIn = form.elements.end; const book = el.querySelector('#book');
  const range = () => ({ start: sIn.value ? new Date(sIn.value) : null, end: eIn.value ? new Date(eIn.value) : null });
  let picking = 'start'; let cal = null;
  const check = () => {
    if (!cal) return;
    cal.refresh();
    const r = range();
    book.disabled = cal.overdue() || (r.start && r.end && r.end > r.start && cal.conflicts(r.start, r.end).length > 0);
  };
  const keepTime = (input, day) => { const t = new Date(input.value || Date.now()); const n = new Date(day); n.setHours(t.getHours(), t.getMinutes(), 0, 0); return n; };
  const onPickDay = (day) => {
    if (picking === 'start') {
      const s = keepTime(sIn, day); sIn.value = toLocalInput(s);
      if (!(new Date(eIn.value) > s)) eIn.value = toLocalInput(new Date(s.getTime() + 24 * 3600 * 1000));
      picking = 'end';
    } else {
      const e = keepTime(eIn, day);
      if (e > new Date(sIn.value)) { eIn.value = toLocalInput(e); picking = 'start'; }
      else { sIn.value = toLocalInput(keepTime(sIn, day)); eIn.value = toLocalInput(new Date(new Date(sIn.value).getTime() + 24 * 3600 * 1000)); }
    }
    check();
  };
  sIn.oninput = check; eIn.oninput = check; bindQuick(form, check);
  cal = await mountItemCalendar(el.querySelector('#cal'), item.id, { getRange: range, onPickDay });
  check();
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(book, async () => {
      await data.rentItem({ p_item_id: item.id, p_start: new Date(f.get('start')).toISOString(), p_end: new Date(f.get('end')).toISOString(), p_project: f.get('project'), p_borrower: f.get('borrower') || null });
      setPref('project', f.get('project')); if (f.get('borrower')) setPref('borrower', f.get('borrower'));
      close(); toast('Ausleihe gebucht', 'success'); reload();
    });
  };
}

export function consumeModal(item, reload) {
  const { el, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">Entnahme: ${esc(item.name)}</h3>
    <form id="f" class="space-y-3">
      <div><label class="label">Stückzahl (Bestand: ${item.stock_quantity})</label><input type="number" name="qty" min="1" max="${item.stock_quantity}" value="1" class="input" required></div>
      <div><label class="label">Verwendungszweck</label><input name="reason" class="input"></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Entnahme buchen</button></div>
    </form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      const left = await data.consumeItem({ p_item_id: item.id, p_qty: Number(f.get('qty')), p_reason: f.get('reason') });
      close(); toast(`Entnommen. Neuer Bestand: ${left}`, 'success'); reload();
    });
  };
}
