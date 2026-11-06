import { supabase, unwrap } from '../lib/supabase.js';
import QRCode from 'qrcode';
import { openNewItem } from '../components/newItem.js';
import { openImportWizard } from '../components/importWizard.js';
import { openEditItem, openBulkEdit, deleteItems } from '../components/itemEdit.js';
import { printLabels } from '../components/labels.js';
import { openPhotoManager } from '../components/photoManager.js';
import { openGallery } from '../components/gallery.js';
import { thumbUrl } from '../lib/photos.js';
import { esc, toast, openModal, busy, toLocalInput, fmtDateTime } from '../lib/ui.js';
import { state, canManageRoom, isManager } from '../state.js';

let currentRoom = null;
let search = '';

export const openRoom = (id) => { currentRoom = id; search = ''; selectMode = false; sel.clear(); };

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

const resetSelection = () => { selectMode = false; sel.clear(); };

async function renderRoom(el) {
  const room = state.rooms.find((r) => r.id === currentRoom);
  const canManageHere = currentRoom === 'ALL' ? isManager() : canManageRoom(currentRoom);
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button id="back" class="btn-ghost">← Räume</button>
      <h1 class="text-xl font-bold">${esc(room ? room.icon + ' ' + room.name : '🌐 Gesamtes Lager')}</h1>
      ${canManageHere ? '<div class="ml-auto flex flex-wrap gap-2"><button id="selToggle" class="btn-ghost">☑️ Auswählen</button><button id="importBtn" class="btn-ghost">📊 Excel-Import</button><button id="newItem" class="btn-primary">+ Neuer Artikel</button></div>' : ''}
    </div>
    <input id="q" class="input mb-4" placeholder="Suchen (Name, Kategorie, ID)…" value="${esc(search)}">
    <div id="bulkBar"></div>
    <div id="list" class="grid gap-3 md:grid-cols-2"><p class="text-sm text-slate-400">Lade…</p></div>`;
  el.querySelector('#back').onclick = () => { currentRoom = null; resetSelection(); render(el); };
  el.querySelector('#importBtn')?.addEventListener('click', () => openImportWizard({ defaultRoom: currentRoom, done: () => renderRoom(el) }));
  el.querySelector('#newItem')?.addEventListener('click', () => openNewItem({ defaultRoom: currentRoom, done: () => renderRoom(el) }));
  const toggleBtn = el.querySelector('#selToggle');
  const markToggle = () => { if (toggleBtn) toggleBtn.className = selectMode ? 'btn-primary' : 'btn-ghost'; };
  if (toggleBtn) toggleBtn.onclick = () => { selectMode = !selectMode; if (!selectMode) sel.clear(); markToggle(); paint(el); };
  markToggle();
  let timer;
  el.querySelector('#q').oninput = (e) => { search = e.target.value; clearTimeout(timer); timer = setTimeout(() => loadItems(el), 250); };
  loadItems(el);
}

// gleiche Filter für Liste und "Alle auswählen"
function filtered(q) {
  if (currentRoom !== 'ALL') q = q.eq('room_id', currentRoom);
  const term = search.trim().replace(/[%,()]/g, ' ');
  if (term) q = q.or(`name.ilike.%${term}%,category.ilike.%${term}%,id.ilike.%${term}%`);
  return q;
}

async function loadItems(el) {
  const list = el.querySelector('#list');
  try {
    const items = unwrap(await filtered(supabase.from('items').select('*').order('name').limit(200)));
    const ids = items.map((i) => i.id);
    const busyRows = ids.length ? unwrap(await supabase.from('rental_calendar').select('item_id, end_at, borrower_name, start_at')
      .in('item_id', ids).eq('status', 'active').lte('start_at', new Date().toISOString())) : [];
    lastItems = items;
    lastRented = Object.fromEntries(busyRows.map((r) => [r.item_id, r]));
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
  if (!it || !canManageRoom(it.room_id)) return;
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
  const none = sel.size ? '' : 'disabled';
  bar.innerHTML = `<div class="sticky top-2 z-30 mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-lg"><div class="flex flex-wrap items-center gap-2">
    <b class="text-sm">${sel.size} ausgewählt</b>
    <button id="bAll" class="btn-ghost !py-1.5 !text-xs">Alle auswählen</button>
    <button id="bNone" class="btn-ghost !py-1.5 !text-xs" ${none}>Auswahl aufheben</button>
    <button id="bEdit" class="btn-ghost !py-1.5 !text-xs" ${none}>✏️ Bearbeiten</button>
    <select id="bStatus" class="input !w-auto !py-1.5 text-xs" ${none}><option value="">Status ändern…</option><option value="maintenance">🛠 Defekt / Wartung</option><option value="inventory">📋 In Inventur</option><option value="active">✅ Freigeben</option></select>
    <button id="bQr" class="btn-ghost !py-1.5 !text-xs" ${none}>🏷️ Etiketten (A4)</button>
    <button id="bDel" class="btn-danger !py-1.5 !text-xs" ${none}>🗑 Löschen</button>
    <button id="bEnd" class="btn-ghost ml-auto !py-1.5 !text-xs">✖ Beenden</button></div></div>`;
  const reload = () => loadItems(el);
  bar.querySelector('#bAll').onclick = (e) => busy(e.target, async () => {
    const rows = unwrap(await filtered(supabase.from('items').select('id, room_id').order('id').range(0, 4999)));
    rows.filter((r) => canManageRoom(r.room_id)).forEach((r) => sel.add(r.id));
    toast(`${sel.size} Artikel ausgewählt`, 'success'); paint(el);
  });
  bar.querySelector('#bNone').onclick = () => { sel.clear(); paint(el); };
  bar.querySelector('#bEnd').onclick = () => { resetSelection(); const t = el.querySelector('#selToggle'); if (t) t.className = 'btn-ghost'; paint(el); };
  bar.querySelector('#bEdit').onclick = (e) => busy(e.target, async () => openBulkEdit(await itemsByIds([...sel]), () => { reload(); }));
  bar.querySelector('#bDel').onclick = (e) => busy(e.target, async () => deleteItems(await itemsByIds([...sel]), () => { sel.clear(); reload(); }));
  bar.querySelector('#bQr').onclick = () => printLabels([...sel]);
  bar.querySelector('#bStatus').onchange = (e) => { const status = e.target.value; if (!status) return;
    busy(e.target, async () => {
      const n = unwrap(await supabase.rpc('bulk_set_item_status', { p_ids: [...sel], p_status: status }));
      toast(`${n} Artikel aktualisiert`, 'success'); reload();
    }); };
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
  const loc = [i.shelf, i.compartment].filter(Boolean).join(' · ');
  const small = '!px-2.5 !py-1 !text-xs';
  const actions = `
        ${i.item_type === 'consumable' ? `<button data-act="consume" data-id="${esc(i.id)}" class="btn-primary ${small}">Entnehmen</button>`
          : i.status === 'active' ? `<button data-act="rent" data-id="${esc(i.id)}" class="btn-primary ${small}">Ausleihen</button>` : ''}
        <button data-act="qr" data-id="${esc(i.id)}" class="btn-ghost ${small}">QR</button>
        ${manage && i.status === 'active' ? `<button data-act="status" data-status="maintenance" data-id="${esc(i.id)}" class="btn-ghost ${small}">🛠 Defekt</button>` : ''}
        ${manage && i.status !== 'active' ? `<button data-act="status" data-status="active" data-id="${esc(i.id)}" class="btn-ghost ${small}">✅ Freigeben</button>` : ''}
        ${manage ? `<button data-act="photos" data-id="${esc(i.id)}" class="btn-ghost ${small}">📷</button><button data-act="edit" data-id="${esc(i.id)}" class="btn-ghost ${small}">✏️</button><button data-act="delete" data-id="${esc(i.id)}" class="btn-ghost ${small} !text-red-600">🗑</button>` : ''}`;
  return `<article data-card="${esc(i.id)}" class="card flex gap-3 ${selectMode ? 'cursor-pointer' : ''} ${sel.has(i.id) ? 'ring-2 ring-brand-500' : ''} ${selectMode && !manage ? 'opacity-50' : ''}">
    ${selectMode ? `<input type="checkbox" tabindex="-1" ${sel.has(i.id) ? 'checked' : ''} ${manage ? '' : 'disabled'} class="mt-1 h-5 w-5 shrink-0 rounded text-brand-600">` : ''}
    ${photo ? `<div class="relative h-16 w-16 shrink-0"><img ${selectMode ? '' : `data-act="gallery" data-id="${esc(i.id)}"`} src="${esc(thumbUrl(photo))}" alt="" loading="lazy" decoding="async" class="h-16 w-16 rounded-xl object-cover ${selectMode ? '' : 'cursor-zoom-in'}">${i.photos.length > 1 ? `<span class="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 text-[10px] font-bold text-white">${i.photos.length}</span>` : ''}</div>` : '<div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl">📦</div>'}
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5"><h3 class="truncate font-bold">${esc(i.name)}</h3>${i.item_type === 'kit' ? '<span class="badge bg-purple-100 text-purple-700">KIT</span>' : ''}</div>
      <p class="text-xs text-slate-500">${esc(i.id)} · ${esc(i.room_id)}${loc ? ' · ' + esc(loc) : ''}</p>
      <div class="mt-1 flex items-center gap-2">${statusBadge(i, rental)}${rental ? `<span class="text-[11px] text-slate-500">bis ${fmtDateTime(rental.end_at)}</span>` : ''}</div>
      ${selectMode ? '' : `<div class="mt-2 flex flex-wrap gap-2">${actions}</div>`}
    </div></article>`;
}

async function handleAction(btn, items, reload) {
  const item = items.find((i) => i.id === btn.dataset.id);
  if (btn.dataset.act === 'rent') return rentModal(item, reload);
  if (btn.dataset.act === 'consume') return consumeModal(item, reload);
  if (btn.dataset.act === 'qr') return qrModal(item);
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
    <form id="f" class="space-y-3">
      ${people.length ? `<div><label class="label">Ausleihen für</label><select name="borrower" class="input">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === state.user.id ? 'selected' : ''}>${esc(p.full_name || p.username)} (@${esc(p.username)})</option>`).join('')}</select></div>` : ''}
      <div><label class="label">Projekt / Einsatzort</label><input name="project" class="input" placeholder="optional"></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Beginn</label><input type="datetime-local" name="start" step="900" value="${toLocalInput(start)}" class="input" required></div>
        <div><label class="label">Rückgabe</label><input type="datetime-local" name="end" step="900" value="${toLocalInput(end)}" class="input" required></div>
      </div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Verbindlich buchen</button></div>
    </form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
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
