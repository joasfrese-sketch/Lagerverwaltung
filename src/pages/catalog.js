import { displayName } from '../lib/format.js';
import { supabase, unwrap, safeData } from '../lib/supabase.js';
import QRCode from 'qrcode';
import { openNewItem } from '../components/newItem.js';
import { openImportWizard } from '../components/importWizard.js';
import { openEditItem, openBulkEdit, deleteItems } from '../components/itemEdit.js';
import { printLabels } from '../components/labels.js';
import { openPhotoManager } from '../components/photoManager.js';
import { openGallery } from '../components/gallery.js';
import { thumbUrl } from '../lib/photos.js';
import { openExport } from '../components/exportDialog.js';
import { fetchAll } from '../lib/export.js';
import { mountItemCalendar } from '../components/itemCalendar.js';
import { openInspection, inspectionState } from '../components/inspection.js';
import { openSheet } from '../components/sheet.js';
import { esc, toast, openModal, busy, toLocalInput, fmtDateTime } from '../lib/ui.js';
import { state, canManageRoom, isManager } from '../state.js';

let currentRoom = null;
let search = '';

const F = { status: 'ALL', category: '', type: '', sort: 'name' };
const SORTS = { name: ['name', true], name_desc: ['name', false], new: ['created_at', false], stock: ['stock_quantity', true], inspection: ['next_inspection_at', true] };
let lastCats = [];
let lastCount = '';
const resetFilters = () => Object.assign(F, { status: 'ALL', category: '', type: '', sort: 'name' });
export const openRoom = (id, term = '') => { currentRoom = id; search = term; resetFilters(); selectMode = false; sel.clear(); };

export async function render(el) {
  try { await (currentRoom ? renderRoom(el) : renderRooms(el)); }
  catch (e) { el.innerHTML = `<div class="card text-red-600">${esc(e.message)}</div>`; }
}

async function renderRooms(el) {
  const items = unwrap(await supabase.from('items').select('room_id'));
  const counts = items.reduce((m, i) => ((m[i.room_id] = (m[i.room_id] || 0) + 1), m), {});
  el.innerHTML = `
    <h1 class="mb-1 text-2xl font-bold">Katalog</h1>
    <p class="mb-4 text-sm text-slate-500">Wähle einen Lagerraum.</p>
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
      ${state.rooms.map((r) => `<button data-room="${esc(r.id)}" class="card text-left transition hover:border-brand-500 hover:shadow-md">
        <div class="text-3xl">${esc(r.icon)}</div><div class="mt-2 font-bold">${esc(r.name)}</div>
        <div class="text-xs text-slate-500">${esc(r.description)}</div><div class="mt-2 text-xs font-semibold text-brand-600">${counts[r.id] || 0} Objekte →</div></button>`).join('')}
      <button data-room="ALL" class="card !bg-[#0f172a] text-left text-white"><div class="text-3xl">🌐</div><div class="mt-2 font-bold">Gesamtes Lager</div><div class="mt-2 text-xs text-brand-100">${items.length} Objekte →</div></button>
    </div>`;
  el.querySelectorAll('[data-room]').forEach((b) => (b.onclick = () => { openRoom(b.dataset.room); render(el); }));
}

let selectMode = false;
const sel = new Set();
let lastItems = [];
let lastRented = {};
let lastWait = new Set();
const isBorrowable = (i) => i.item_type !== 'consumable' && i.status === 'active';

const resetSelection = () => { selectMode = false; sel.clear(); };

async function renderRoom(el) {
  const room = state.rooms.find((r) => r.id === currentRoom);
  const canManageHere = currentRoom === 'ALL' ? isManager() : canManageRoom(currentRoom);
  el.innerHTML = `
    <div class="mb-3 flex items-center gap-2">
      <button id="back" class="btn-ghost !px-3" aria-label="Zurück zu den Räumen">←</button>
      <h1 class="min-w-0 flex-1 truncate text-lg font-bold">${esc(room ? room.icon + ' ' + room.name : '🌐 Alle Räume')}</h1>
      ${canManageHere ? '<button id="newItem" class="btn-primary">+ Neu</button><button id="moreBtn" class="btn-ghost !px-3.5 text-lg leading-none" aria-label="Weitere Aktionen">⋯</button>' : '<button id="selToggle" class="btn-ghost">☑️ Mehrere ausleihen</button>'}
    </div>
    <div class="mb-2 flex gap-2">
      <input id="q" class="input min-w-0 flex-1" placeholder="Artikel suchen…" value="${esc(search)}">
      <button id="filterBtn" class="btn-ghost shrink-0">⚙️ Filter<span id="fBadge" class="ml-1 hidden rounded-full bg-brand-600 px-1.5 text-[13px] font-bold leading-5 text-white"></span></button>
    </div>
    <div id="filters" class="mb-3 flex flex-wrap items-center gap-1.5 text-xs"></div>
    <div id="bulkBar"></div>
    <div id="list" class="grid gap-3 md:grid-cols-2"><p class="text-sm text-slate-400">Lade…</p></div>`;
  el.querySelector('#back').onclick = () => { currentRoom = null; resetSelection(); resetFilters(); render(el); };
  el.querySelector('#newItem')?.addEventListener('click', () => openNewItem({ defaultRoom: currentRoom, done: () => renderRoom(el) }));
  const doExport = () => openExport({ title: 'Artikel exportieren', filename: room ? `artikel-${room.id}` : 'artikel-alle', load: async () => {
    const rows = await fetchAll(() => filtered(supabase.from('catalog_items').select('*')).order('id'));
    return { columns: [['id', 'ID'], ['name', 'Bezeichnung'], ['room_id', 'Raum'], ['category', 'Kategorie'], ['item_type', 'Typ'], ['status', 'Status'], ['stock_quantity', 'Bestand'], ['min_stock', 'Mindestbestand'], ['shelf', 'Regal'], ['compartment', 'Fach'], ['acc', 'Zubehör'], ['required_permission', 'Berechtigung'], ['inspection_interval_months', 'Prüfintervall (Monate)'], ['last_insp', 'Letzte Prüfung'], ['next_insp', 'Nächste Prüfung']].map(([key, label]) => ({ key, label })),
      rows: rows.map((i) => ({ ...i, acc: (i.accessories || []).join(', '), last_insp: i.last_inspection_at ? fmtDateTime(i.last_inspection_at) : '', next_insp: i.next_inspection_at ? fmtDateTime(i.next_inspection_at) : '' })) };
  } });
  const toggleBtn = el.querySelector('#selToggle');
  const markToggle = () => { if (toggleBtn) toggleBtn.className = selectMode ? 'btn-primary' : 'btn-ghost'; };
  const toggleSelect = () => { selectMode = !selectMode; if (!selectMode) sel.clear(); markToggle(); paint(el); };
  if (toggleBtn) toggleBtn.onclick = toggleSelect;
  markToggle();
  el.querySelector('#moreBtn')?.addEventListener('click', () => openSheet('Weitere Aktionen', [
    { label: '☑️ Mehrere auswählen', run: toggleSelect },
    { label: '📊 Excel-Import', run: () => openImportWizard({ defaultRoom: currentRoom, done: () => renderRoom(el) }) },
    { label: '⬇️ Export (Excel / CSV)', run: doExport },
  ]));
  el.querySelector('#filterBtn').onclick = () => openFilterSheet(el);
  let timer;
  el.querySelector('#q').oninput = (e) => { search = e.target.value; clearTimeout(timer); timer = setTimeout(() => loadItems(el), 250); };
  drawFilters(el);
  loadCats(el);
  loadItems(el);
}

// gleiche Filter für Liste und "Alle auswählen"
function filtered(q) {
  if (currentRoom !== 'ALL') q = q.eq('room_id', currentRoom);
  const term = search.trim().replace(/[%,()]/g, ' ');
  if (term) q = q.or(`name.ilike.%${term}%,category.ilike.%${term}%,id.ilike.%${term}%`);
  if (F.status === 'avail') q = q.eq('status', 'active').or('and(item_type.neq.consumable,rented_now.eq.false),and(item_type.eq.consumable,stock_quantity.gt.0)');
  else if (F.status === 'rented') q = q.eq('rented_now', true);
  else if (F.status === 'maintenance') q = q.eq('status', 'maintenance');
  else if (F.status === 'inventory') q = q.eq('status', 'inventory');
  else if (F.status === 'low') q = q.eq('low_stock', true);
  else if (F.status === 'inspection') q = q.eq('inspection_due', true);
  if (F.category) q = q.eq('category', F.category);
  if (F.type) q = q.eq('item_type', F.type);
  return q;
}

async function loadCats(el) {
  let q = supabase.from('items').select('category').limit(5000);
  if (currentRoom !== 'ALL') q = q.eq('room_id', currentRoom);
  lastCats = [...new Set((await safeData(q)).map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  drawFilters(el);
}

const STATUS_CHIPS = [['ALL', 'Alle'], ['avail', '✅ Verfügbar'], ['rented', 'Ausgeliehen'], ['maintenance', '🛠 Defekt'], ['inventory', '📋 Inventur'], ['low', '📉 Bestand niedrig'], ['inspection', '🔧 Prüfung fällig']];
const TYPE_OPTS = [['', 'Alle Typen'], ['standard', 'Standard'], ['kit', 'Kit / Koffer'], ['consumable', 'Verbrauchsmaterial']];
const SORT_OPTS = [['name', 'Name A–Z'], ['name_desc', 'Name Z–A'], ['new', 'Neueste zuerst'], ['stock', 'Bestand (niedrig zuerst)'], ['inspection', 'Nächste Prüfung']];
const labelOf = (list, v) => (list.find(([x]) => x === v) || [])[1] || v;
const activeFilters = () => [
  F.status !== 'ALL' && ['status', labelOf(STATUS_CHIPS, F.status)],
  F.category && ['category', F.category],
  F.type && ['type', labelOf(TYPE_OPTS, F.type)],
  F.sort !== 'name' && ['sort', `Sortiert: ${labelOf(SORT_OPTS, F.sort)}`],
].filter(Boolean);

// Zeigt nur die aktiven Filter als entfernbare Chips + Trefferzahl; alle Einstellungen liegen im Filter-Fenster
function drawFilters(el) {
  const box = el.querySelector('#filters');
  if (!box) return;
  const act = activeFilters();
  const badge = el.querySelector('#fBadge');
  if (badge) { badge.textContent = act.length; badge.classList.toggle('hidden', !act.length); }
  box.innerHTML = act.map(([k, l]) => `<button data-rm="${k}" class="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 font-semibold text-brand-700">${esc(l)} <span aria-hidden="true">✕</span></button>`).join('')
    + (act.length > 1 ? '<button data-rm="all" class="px-1 font-semibold text-slate-500 underline">Alle zurücksetzen</button>' : '')
    + `<span id="count" class="ml-auto text-slate-400">${lastCount}</span>`;
  box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.rm;
    if (k === 'all') resetFilters(); else if (k === 'status') F.status = 'ALL'; else if (k === 'category') F.category = ''; else if (k === 'type') F.type = ''; else if (k === 'sort') F.sort = 'name';
    drawFilters(el); loadItems(el);
  }));
}

function openFilterSheet(el) {
  const d = { ...F };
  const { el: m, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">⚙️ Filter &amp; Sortierung</h3>
    <div class="space-y-4">
      <div><label class="label">Status</label><div id="chips" class="flex flex-wrap gap-1.5"></div></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Kategorie</label><select id="dCat" class="input"><option value="">Alle</option>${lastCats.map((c) => `<option value="${esc(c)}" ${c === d.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div><label class="label">Typ</label><select id="dType" class="input">${TYPE_OPTS.map(([v, l]) => `<option value="${v}" ${v === d.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div><label class="label">Sortierung</label><select id="dSort" class="input">${SORT_OPTS.map(([v, l]) => `<option value="${v}" ${v === d.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="mt-5 flex gap-2"><button id="dReset" class="btn-ghost flex-1">Zurücksetzen</button><button id="dApply" class="btn-primary flex-[2]">Anwenden</button></div>`);
  const chips = () => {
    m.querySelector('#chips').innerHTML = STATUS_CHIPS.map(([v, l]) => `<button type="button" data-st="${v}" class="rounded-full px-3 py-1.5 text-xs font-semibold ${d.status === v ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${l}</button>`).join('');
    m.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => { d.status = b.dataset.st; chips(); }));
  };
  chips();
  m.querySelector('#dCat').onchange = (e) => { d.category = e.target.value; };
  m.querySelector('#dType').onchange = (e) => { d.type = e.target.value; };
  m.querySelector('#dSort').onchange = (e) => { d.sort = e.target.value; };
  m.querySelector('#dReset').onclick = () => { Object.assign(F, { status: 'ALL', category: '', type: '', sort: 'name' }); close(); drawFilters(el); loadItems(el); };
  m.querySelector('#dApply').onclick = () => { Object.assign(F, d); close(); drawFilters(el); loadItems(el); };
}

async function loadItems(el) {
  const list = el.querySelector('#list');
  try {
    const [col, asc] = SORTS[F.sort] || SORTS.name;
    const { data, count, error } = await filtered(supabase.from('catalog_items').select('*', { count: 'exact' }))
      .order(col, { ascending: asc }).order('name').limit(200);
    if (error) throw new Error(error.message);
    lastWait = new Set((await safeData(supabase.from('waitlist').select('item_id'))).map((w) => w.item_id));
    lastItems = data;
    lastRented = Object.fromEntries(data.filter((i) => i.rented_now).map((i) => [i.id, { end_at: i.rented_until }]));
    lastCount = `${count} Treffer${count > data.length ? ` (erste ${data.length} angezeigt)` : ''}`;
    const c = el.querySelector('#count'); if (c) c.textContent = lastCount;
    paint(el);
  } catch (e) { list.innerHTML = `<p class="text-red-600">${esc(e.message)}</p>`; }
}

function paint(el) {
  const list = el.querySelector('#list');
  if (!list) return;
  if (!lastItems.length) list.innerHTML = '<p class="col-span-full py-8 text-center italic text-slate-400">Keine Objekte gefunden.</p>';
  else {
    list.innerHTML = lastItems.map((i) => itemCard(i, lastRented[i.id])).join('');
    list.querySelectorAll('[data-act]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); handleAction(b, lastItems, () => loadItems(el)); }));
    if (selectMode) list.querySelectorAll('[data-card]').forEach((c) => (c.onclick = () => toggleSel(c.dataset.card, el)));
  }
  drawBulk(el);
}

function toggleSel(id, el) {
  const it = lastItems.find((i) => i.id === id);
  if (!it || !(canManageRoom(it.room_id) || isBorrowable(it))) return;
  if (sel.has(id)) sel.delete(id); else sel.add(id);
  paint(el);
}

async function itemsByIds(ids) {
  let out = [];
  for (let i = 0; i < ids.length; i += 100) out = out.concat(unwrap(await supabase.from('items').select('*').in('id', ids.slice(i, i + 100))));
  return out;
}

function drawBulk(el) {
  const bar = el.querySelector('#bulkBar');
  if (!bar) return;
  if (!selectMode) { bar.innerHTML = ''; return; }
  const mgr = isManager();
  const none = sel.size ? '' : 'disabled';
  bar.innerHTML = `<div class="sticky top-2 z-30 mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
    <div class="flex items-center gap-2">
      <b class="text-sm">${sel.size} ausgewählt</b>
      <button id="bAll" class="btn-ghost !py-1.5 !text-xs">${mgr ? 'Alle' : 'Alle verfügbaren'}</button>
      ${sel.size ? '<button id="bNone" class="text-xs font-semibold text-slate-500 underline">aufheben</button>' : ''}
      <button id="bEnd" class="btn-ghost ml-auto !py-1.5 !text-xs">✖ Beenden</button></div>
    <div class="mt-2 flex gap-2"><button id="bRent" class="btn-primary flex-1 !py-2 !text-sm" ${none}>📤 Ausleihen</button>
      ${mgr ? `<button id="bMore" class="btn-ghost flex-1 !py-2 !text-sm" ${none}>Aktionen ▾</button>` : ''}</div></div>`;
  const reload = () => loadItems(el);
  // Verwaltungsaktionen nur für Artikel, für die man zuständig ist
  const managed = async () => {
    const all = await itemsByIds([...sel]); const ok = all.filter((i) => canManageRoom(i.room_id));
    if (ok.length < all.length) toast(`${all.length - ok.length} Artikel ohne Berechtigung werden übersprungen.`, 'info');
    return ok;
  };
  const setStatus = (status) => busy(null, async () => {
    const items = await managed(); if (!items.length) return;
    const n = unwrap(await supabase.rpc('bulk_set_item_status', { p_ids: items.map((i) => i.id), p_status: status }));
    toast(`${n} Artikel aktualisiert`, 'success'); reload();
  });
  bar.querySelector('#bAll').onclick = (e) => busy(e.target, async () => {
    const rows = unwrap(await filtered(supabase.from('catalog_items').select('id, room_id, item_type, status').order('id').range(0, 4999)));
    rows.filter((r) => (mgr ? canManageRoom(r.room_id) : isBorrowable(r))).forEach((r) => sel.add(r.id));
    toast(`${sel.size} Artikel ausgewählt`, 'success'); paint(el);
  });
  bar.querySelector('#bNone')?.addEventListener('click', () => { sel.clear(); paint(el); });
  bar.querySelector('#bEnd').onclick = () => { resetSelection(); const t = el.querySelector('#selToggle'); if (t) t.className = 'btn-ghost'; paint(el); };
  bar.querySelector('#bRent').onclick = (e) => busy(e.target, async () => {
    const all = await itemsByIds([...sel]); const items = all.filter(isBorrowable);
    if (!items.length) throw new Error('Keiner der gewählten Artikel ist ausleihbar.');
    if (items.length > 50) throw new Error('Höchstens 50 Artikel auf einmal.');
    if (items.length < all.length) toast(`${all.length - items.length} nicht ausleihbare Artikel wurden ausgelassen.`, 'info');
    bulkRentModal(items, (booked) => { booked.forEach((id) => sel.delete(id)); reload(); });
  });
  bar.querySelector('#bMore')?.addEventListener('click', () => openSheet(`${sel.size} Artikel`, [
    { label: '✏️ Bearbeiten', run: () => busy(null, async () => { const items = await managed(); if (items.length) openBulkEdit(items, reload); }) },
    { label: '🛠 Als defekt / Wartung markieren', run: () => setStatus('maintenance') },
    { label: '📋 In Inventur setzen', run: () => setStatus('inventory') },
    { label: '✅ Freigeben (verfügbar)', run: () => setStatus('active') },
    { label: '🏷️ Etiketten drucken (A4)', run: () => busy(null, async () => { const items = await managed(); if (items.length) printLabels(items.map((i) => i.id)); }) },
    { label: '🗑 Löschen …', danger: true, run: () => busy(null, async () => { const items = await managed(); if (items.length) deleteItems(items, () => { sel.clear(); reload(); }); }) },
  ]));
}

// Sammel-Ausleihe: mehrere Artikel mit gemeinsamem Zeitraum buchen (freie werden gebucht, belegte gemeldet)
async function bulkRentModal(items, onDone) {
  const start = new Date(); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const mgr = isManager();
  const people = mgr ? unwrap(await supabase.from('public_profiles').select('id, full_name, username').order('full_name')) : [];
  const ids = items.map((i) => i.id);
  const from = new Date(); from.setDate(from.getDate() - 35);
  const bookings = (await safeData(supabase.from('rental_calendar').select('item_id, start_at, end_at').in('item_id', ids).eq('status', 'active').gte('end_at', from.toISOString())))
    .map((b) => ({ id: b.item_id, s: new Date(b.start_at), e: new Date(b.end_at) }));
  const { el, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">${items.length} Artikel ausleihen</h3>
    <div class="grid gap-5 md:grid-cols-2">
      <form id="f" class="space-y-3">
        ${mgr ? `<div><label class="label">Ausleihen für</label><select name="borrower" class="input">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === state.user.id ? 'selected' : ''}>${esc(displayName(p))} (@${esc(p.username)})</option>`).join('')}</select></div>` : ''}
        <div><label class="label">Projekt / Einsatzort</label><input name="project" class="input" placeholder="optional"></div>
        <div class="grid grid-cols-2 gap-2"><div><label class="label">Beginn</label><input type="datetime-local" name="start" step="900" value="${toLocalInput(start)}" class="input" required></div>
          <div><label class="label">Rückgabe</label><input type="datetime-local" name="end" step="900" value="${toLocalInput(end)}" class="input" required></div></div>
        <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button id="book" class="btn-primary">Buchen</button></div>
      </form>
      <div><h4 class="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Verfügbarkeit im Zeitraum</h4><div id="list" class="max-h-72 space-y-1.5 overflow-y-auto"></div></div>
    </div>`, { wide: true });
  const form = el.querySelector('#f'); const book = el.querySelector('#book');
  let free = [];
  const check = () => {
    const s = new Date(form.elements.start.value); const e = new Date(form.elements.end.value);
    const valid = e > s;
    free = [];
    el.querySelector('#list').innerHTML = items.map((i) => {
      const bs = bookings.filter((b) => b.id === i.id);
      const late = bs.some((b) => b.e < new Date());
      const clash = valid ? bs.filter((b) => s < b.e && e > b.s) : [];
      const ok = valid && !late && !clash.length;
      if (ok) free.push(i.id);
      return `<div class="rounded-xl p-2 text-sm ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">${ok ? '✅' : '❌'} <b>${esc(i.name)}</b><span class="block text-xs">${ok ? 'frei' : late ? 'überfällig, noch nicht zurückgegeben' : !valid ? 'Zeitraum ungültig' : 'belegt: ' + clash.map((b) => fmtDateTime(b.s) + ' – ' + fmtDateTime(b.e)).join('; ')}</span></div>`;
    }).join('');
    book.textContent = free.length === items.length ? `${free.length} Artikel buchen` : `${free.length} von ${items.length} buchen`;
    book.disabled = !free.length;
  };
  form.elements.start.oninput = check; form.elements.end.oninput = check; check();
  form.onsubmit = (ev) => {
    ev.preventDefault(); const f = new FormData(ev.target);
    busy(book, async () => {
      const res = unwrap(await supabase.rpc('rent_items', { p_item_ids: free, p_start: new Date(f.get('start')).toISOString(), p_end: new Date(f.get('end')).toISOString(), p_project: f.get('project'), p_borrower: f.get('borrower') || null }));
      const okIds = res.filter((r) => r.ok).map((r) => r.item_id); const bad = res.filter((r) => !r.ok);
      close();
      if (okIds.length) toast(`${okIds.length} Artikel gebucht`, 'success');
      if (bad.length) openModal(`<h3 class="mb-2 text-lg font-bold text-red-600">Nicht alle gebucht</h3><ul class="mb-3 space-y-1 text-sm">${bad.map((r) => `<li class="rounded-xl bg-red-50 p-2 text-red-700"><b>${esc(items.find((i) => i.id === r.item_id)?.name || r.item_id)}</b>: ${esc(r.error)}</li>`).join('')}</ul><button data-close class="btn-primary w-full">OK</button>`);
      onDone(okIds);
    });
  };
}

function statusBadge(i, rental) {
  if (i.status === 'maintenance') return '<span class="badge bg-red-100 text-red-700">Defekt / Wartung</span>';
  if (i.status === 'inventory') return '<span class="badge bg-blue-100 text-blue-700">In Inventur</span>';
  if (i.item_type === 'consumable') return `<span class="badge ${i.stock_quantity <= i.min_stock ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}">Bestand: ${i.stock_quantity}</span>`;
  if (rental) return '<span class="badge bg-amber-100 text-amber-800">Ausgeliehen</span>';
  return '<span class="badge bg-emerald-100 text-emerald-800">Verfügbar</span>';
}

function itemCard(i, rental) {
  const photo = Array.isArray(i.photos) && i.photos[0];
  const manage = canManageRoom(i.room_id);
  const selectable = manage || isBorrowable(i);
  const loc = [i.shelf, i.compartment].filter(Boolean).join(' · ');
  const insp = inspectionState(i);
  const small = '!px-2.5 !py-1 !text-xs';
  const rentable = i.item_type !== 'consumable' && (rental || i.status !== 'active');
  const actions = `
        ${i.item_type === 'consumable' ? `<button data-act="consume" data-id="${esc(i.id)}" class="btn-primary ${small}">Entnehmen</button>`
          : i.status === 'active' ? `<button data-act="rent" data-id="${esc(i.id)}" class="btn-primary ${small}">Ausleihen</button>` : ''}
        ${rentable ? `<button data-act="wait" data-id="${esc(i.id)}" class="btn-ghost ${small}">${lastWait.has(i.id) ? '🔔 Benachrichtigung aktiv ✓' : '🔔 Benachrichtigen'}</button>` : ''}
`;
  const more = selectMode ? '' : `<button data-act="more" data-id="${esc(i.id)}" class="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-base font-bold leading-none text-slate-600 hover:bg-slate-200" aria-label="Weitere Aktionen">⋯</button>`;
  return `<article data-card="${esc(i.id)}" class="card relative flex gap-3 ${selectMode ? 'cursor-pointer' : ''} ${sel.has(i.id) ? 'ring-2 ring-brand-500' : ''} ${selectMode && !selectable ? 'opacity-50' : ''}">
    ${selectMode ? `<input type="checkbox" tabindex="-1" ${sel.has(i.id) ? 'checked' : ''} ${selectable ? '' : 'disabled'} class="mt-1 h-5 w-5 shrink-0 rounded text-brand-600">` : ''}
    ${photo ? `<div class="relative h-16 w-16 shrink-0"><img ${selectMode ? '' : `data-act="gallery" data-id="${esc(i.id)}"`} src="${esc(thumbUrl(photo))}" alt="" loading="lazy" decoding="async" class="h-16 w-16 rounded-xl object-cover ${selectMode ? '' : 'cursor-zoom-in'}">${i.photos.length > 1 ? `<span class="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 text-[12px] font-bold text-white">${i.photos.length}</span>` : ''}</div>` : '<div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl">📦</div>'}
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5 pr-9"><h3 class="truncate font-bold">${esc(i.name)}</h3>${i.item_type === 'kit' ? '<span class="badge bg-purple-100 text-purple-700">KIT</span>' : ''}</div>
      <p class="text-xs text-slate-500">${esc(i.id)} · ${esc(i.room_id)}${loc ? ' · ' + esc(loc) : ''}</p>
      <div class="mt-1 flex flex-wrap items-center gap-2">${statusBadge(i, rental)}${rental ? `<span class="text-[13px] text-slate-500">bis ${fmtDateTime(rental.end_at)}</span>` : ''}${insp && insp.level !== 'ok' ? `<span class="badge ${insp.level === 'due' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}">🔧 ${esc(insp.text)}</span>` : ''}</div>
      ${selectMode ? '' : `<div class="mt-2 flex flex-wrap gap-2">${actions}</div>`}
    </div>${more}</article>`;
}

async function handleAction(btn, items, reload) {
  const item = items.find((i) => i.id === btn.dataset.id);
  if (btn.dataset.act === 'rent') return rentModal(item, reload);
  if (btn.dataset.act === 'consume') return consumeModal(item, reload);
  if (btn.dataset.act === 'qr') return qrModal(item);
  if (btn.dataset.act === 'more') {
    const manage = canManageRoom(item.room_id);
    const go = (act, extra = {}) => () => handleAction({ dataset: { act, id: item.id, ...extra } }, items, reload);
    return openSheet(item.name, [
      { label: '🏷️ QR-Code / Etikett', run: go('qr') },
      ...(manage && item.status === 'active' ? [{ label: '🛠 Als defekt markieren', run: go('status', { status: 'maintenance' }) }] : []),
      ...(manage && item.status !== 'active' ? [{ label: '✅ Freigeben', run: go('status', { status: 'active' }) }] : []),
      ...(manage && item.inspection_interval_months ? [{ label: '🔧 Prüfung eintragen', run: go('inspect') }] : []),
      ...(manage ? [{ label: `📷 Fotos (${(item.photos || []).length}/5)`, run: go('photos') }, { label: '✏️ Bearbeiten', run: go('edit') }, { label: '🗑 Löschen …', danger: true, run: go('delete') }] : []),
    ]);
  }
  if (btn.dataset.act === 'wait') {
    return busy(btn, async () => {
      const on = lastWait.has(item.id);
      unwrap(await supabase.rpc(on ? 'leave_waitlist' : 'join_waitlist', { p_item_id: item.id }));
      toast(on ? 'Benachrichtigung abbestellt' : 'Du wirst benachrichtigt, sobald der Artikel frei ist', 'success'); reload();
    });
  }
  if (btn.dataset.act === 'inspect') return openInspection(item, reload);
  if (btn.dataset.act === 'edit') return openEditItem(item, reload);
  if (btn.dataset.act === 'photos') return openPhotoManager(item, reload);
  if (btn.dataset.act === 'gallery') return openGallery(item, 0);
  if (btn.dataset.act === 'delete') return deleteItems([item], reload);
  if (btn.dataset.act === 'status') {
    await busy(btn, async () => {
      unwrap(await supabase.rpc('set_item_status', { p_item_id: item.id, p_status: btn.dataset.status }));
      toast('Status aktualisiert', 'success'); reload();
    });
  }
}

export async function rentModal(item, reload) {
  const start = new Date(); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  let people = [];
  if (canManageRoom(item.room_id)) people = unwrap(await supabase.from('public_profiles').select('id, full_name, username').order('full_name'));
  const { el, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">Ausleihe: ${esc(item.name)}</h3>
    <div class="grid gap-5 md:grid-cols-2">
      <form id="f" class="space-y-3">
        ${people.length ? `<div><label class="label">Ausleihen für</label><select name="borrower" class="input">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === state.user.id ? 'selected' : ''}>${esc(displayName(p))} (@${esc(p.username)})</option>`).join('')}</select></div>` : ''}
        <div><label class="label">Projekt / Einsatzort</label><input name="project" class="input" placeholder="optional"></div>
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
  sIn.oninput = check; eIn.oninput = check;
  cal = await mountItemCalendar(el.querySelector('#cal'), item.id, { getRange: range, onPickDay });
  check();
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(book, async () => {
      unwrap(await supabase.rpc('rent_item', {
        p_item_id: item.id, p_start: new Date(f.get('start')).toISOString(), p_end: new Date(f.get('end')).toISOString(),
        p_project: f.get('project'), p_borrower: f.get('borrower') || null,
      }));
      close(); toast('Ausleihe gebucht', 'success'); reload();
    });
  };
}

function consumeModal(item, reload) {
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
      const left = unwrap(await supabase.rpc('consume_item', { p_item_id: item.id, p_qty: Number(f.get('qty')), p_reason: f.get('reason') }));
      close(); toast(`Entnommen. Neuer Bestand: ${left}`, 'success'); reload();
    });
  };
}

async function qrModal(item) {
  const url = await QRCode.toDataURL(`ITEM:${item.id}`, { width: 320, margin: 1 });
  const { el } = openModal(`
    <div class="text-center"><h3 class="mb-1 text-lg font-bold">${esc(item.name)}</h3><div class="mb-2 font-mono text-xs text-slate-500">${esc(item.id)}</div>
    <img src="${url}" alt="QR" class="mx-auto h-56 w-56"><div class="mt-3 flex gap-2"><button id="pr" class="btn-primary flex-1">🖨️ Etikett drucken</button><button data-close class="btn-ghost flex-1">Schließen</button></div></div>`);
  el.querySelector('#pr').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) return toast('Pop-up wurde blockiert.', 'error');
    w.document.write(`<html><head><title>Etikett</title><style>body{font-family:sans-serif;margin:0}.l{width:64mm;height:33.5mm;border:1px dashed #999;display:flex;align-items:center;gap:3mm;padding:2mm;box-sizing:border-box}img{width:26mm;height:26mm}b{font-size:11pt}small{font-size:8pt;color:#444}</style></head><body><div class="l"><img src="${url}"><div><b>${esc(item.name)}</b><br><small>${esc(item.id)}<br>${esc(item.room_id)}</small></div></div><script>onload=()=>print()<\/script></body></html>`);
    w.document.close();
  };
}
