import { openNewItem } from '../components/newItem.js';
import { openImportWizard } from '../components/importWizard.js';
import { openEditItem, openBulkEdit, deleteItems } from '../components/itemEdit.js';
import { printLabels } from '../components/labels.js';
import { openPhotoManager } from '../components/photoManager.js';
import { openGallery } from '../components/gallery.js';
import { openExport } from '../components/exportDialog.js';
import { fetchAll } from '../lib/export.js';
import { emptyState, bindEmpty } from '../components/emptyState.js';
import { openInspection } from '../components/inspection.js';
import { itemCard } from '../components/itemCard.js';
import { qrModal } from '../components/qrModal.js';
import { rentModal, bulkRentModal, consumeModal } from '../components/rentModals.js';
import { isBorrowable, BULK_RENT_LIMIT } from '../lib/rules.js';
import * as data from '../lib/catalogData.js';
import { openSheet } from '../components/sheet.js';
import { esc, toast, openModal, busy, fmtDateTime } from '../lib/ui.js';
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
  const { total, byRoom: counts } = await data.roomCounts();
  el.innerHTML = `
    <h1 class="mb-1 text-2xl font-bold">Katalog</h1>
    <p class="mb-4 text-sm text-slate-500">Wähle einen Lagerraum.</p>
    <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
      ${state.rooms.map((r) => `<button data-room="${esc(r.id)}" class="card text-left transition hover:border-brand-500 hover:shadow-md">
        <div class="text-3xl">${esc(r.icon)}</div><div class="mt-2 font-bold">${esc(r.name)}</div>
        <div class="text-xs text-slate-500">${esc(r.description)}</div><div class="mt-2 text-xs font-semibold text-brand-600">${counts[r.id] || 0} Objekte →</div></button>`).join('')}
      <button data-room="ALL" class="card !bg-[#0f172a] text-left text-white"><div class="text-3xl">🌐</div><div class="mt-2 font-bold">Gesamtes Lager</div><div class="mt-2 text-xs text-brand-100">${total} Objekte →</div></button>
    </div>`;
  el.querySelectorAll('[data-room]').forEach((b) => (b.onclick = () => { openRoom(b.dataset.room); render(el); }));
}

let selectMode = false;
const sel = new Set();
let lastItems = [];
let lastRented = {};
let lastWait = new Set();

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
    const rows = await fetchAll(() => data.applyCatalogFilter(data.catalogQuery('*'), criteria()).order('id'));
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
const criteria = () => ({ room: currentRoom, search, status: F.status, category: F.category, type: F.type });

async function loadCats(el) {
  lastCats = await data.categories(currentRoom);
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
    const { data: rows, count } = await data.listItems(criteria(), [col, asc]);
    lastWait = await data.waitlistIds();
    lastItems = rows;
    lastRented = Object.fromEntries(rows.filter((i) => i.rented_now).map((i) => [i.id, { end_at: i.rented_until }]));
    lastCount = `${count} Treffer${count > rows.length ? ` (erste ${rows.length} angezeigt)` : ''}`;
    const c = el.querySelector('#count'); if (c) c.textContent = lastCount;
    paint(el);
  } catch (e) { list.innerHTML = `<p class="text-red-600">${esc(e.message)}</p>`; }
}

// Leere Liste: entweder ist der Raum wirklich leer (dann erste Schritte anbieten) oder die Suche/der Filter war zu eng
function noResults(el) {
  const narrowed = search.trim() || activeFilters().length;
  if (narrowed) return emptyState({ icon: '🔍', title: 'Nichts gefunden', text: 'Zu deiner Suche passt kein Artikel. Lockere die Suche oder setze die Filter zurück.', actions: [{ id: 'reset', label: 'Suche & Filter zurücksetzen', primary: true }] });
  const mine = canManageRoom(currentRoom === 'ALL' ? null : currentRoom) || isManager();
  return emptyState({ icon: '📦', title: currentRoom === 'ALL' ? 'Das Lager ist noch leer' : 'Dieser Raum ist noch leer',
    text: mine ? 'Lege den ersten Artikel an oder importiere eine vorhandene Excel-Liste. Fotos und QR-Etiketten kannst du danach ergänzen.' : 'Hier wurden noch keine Artikel angelegt.',
    actions: mine ? [{ id: 'new', label: '+ Ersten Artikel anlegen', primary: true }, { id: 'import', label: '📊 Excel importieren' }] : [] });
}

function paint(el) {
  const list = el.querySelector('#list');
  if (!list) return;
  if (!lastItems.length) {
    list.innerHTML = noResults(el);
    bindEmpty(list, {
      reset: () => { search = ''; const q = el.querySelector('#q'); if (q) q.value = ''; resetFilters(); drawFilters(el); loadItems(el); },
      new: () => openNewItem({ defaultRoom: currentRoom, done: () => renderRoom(el) }),
      import: () => openImportWizard({ defaultRoom: currentRoom, done: () => renderRoom(el) }),
    });
  }
  else {
    list.innerHTML = lastItems.map((i) => itemCard(i, lastRented[i.id], { selectMode, selected: sel.has(i.id), waiting: lastWait.has(i.id) })).join('');
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
    const all = await data.itemsByIds([...sel]); const ok = all.filter((i) => canManageRoom(i.room_id));
    if (ok.length < all.length) toast(`${all.length - ok.length} Artikel ohne Berechtigung werden übersprungen.`, 'info');
    return ok;
  };
  const setStatus = (status) => busy(null, async () => {
    const items = await managed(); if (!items.length) return;
    const n = await data.bulkSetStatus(items.map((i) => i.id), status);
    toast(`${n} Artikel aktualisiert`, 'success'); reload();
  });
  bar.querySelector('#bAll').onclick = (e) => busy(e.target, async () => {
    const rows = await data.selectableRows(criteria());
    rows.filter((r) => (mgr ? canManageRoom(r.room_id) : isBorrowable(r))).forEach((r) => sel.add(r.id));
    toast(`${sel.size} Artikel ausgewählt`, 'success'); paint(el);
  });
  bar.querySelector('#bNone')?.addEventListener('click', () => { sel.clear(); paint(el); });
  bar.querySelector('#bEnd').onclick = () => { resetSelection(); const t = el.querySelector('#selToggle'); if (t) t.className = 'btn-ghost'; paint(el); };
  bar.querySelector('#bRent').onclick = (e) => busy(e.target, async () => {
    const all = await data.itemsByIds([...sel]); const items = all.filter(isBorrowable);
    if (!items.length) throw new Error('Keiner der gewählten Artikel ist ausleihbar.');
    if (items.length > BULK_RENT_LIMIT) throw new Error(`Höchstens ${BULK_RENT_LIMIT} Artikel auf einmal.`);
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
      await data.toggleWaitlist(item.id, on);
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
      await data.setItemStatus(item.id, btn.dataset.status);
      toast('Status aktualisiert', 'success'); reload();
    });
  }
}