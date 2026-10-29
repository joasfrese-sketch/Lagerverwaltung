import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy, toLocalInput, fmtDateTime } from '../lib/ui.js';
import { state, canManageRoom, isManager } from '../state.js';

let currentRoom = null;
let search = '';

export function render(el) {
  currentRoom ? renderRoom(el) : renderRooms(el);
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
      <button data-room="ALL" class="card bg-slate-900 text-left text-white"><div class="text-3xl">🌐</div><div class="mt-2 font-bold">Gesamtes Lager</div><div class="mt-2 text-xs text-brand-100">${items.length} Objekte →</div></button>
    </div>`;
  el.querySelectorAll('[data-room]').forEach((b) => (b.onclick = () => { currentRoom = b.dataset.room; search = ''; render(el); }));
}

async function renderRoom(el) {
  const room = state.rooms.find((r) => r.id === currentRoom);
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button id="back" class="btn-ghost">← Räume</button>
      <h1 class="text-xl font-bold">${esc(room ? room.icon + ' ' + room.name : '🌐 Gesamtes Lager')}</h1>
      ${currentRoom !== 'ALL' && canManageRoom(currentRoom) ? '<button id="newItem" class="btn-primary ml-auto">+ Neuer Artikel</button>' : ''}
    </div>
    <input id="q" class="input mb-4" placeholder="Suchen (Name, Kategorie, ID)…" value="${esc(search)}">
    <div id="list" class="grid gap-3 md:grid-cols-2"><p class="text-sm text-slate-400">Lade…</p></div>`;
  el.querySelector('#back').onclick = () => { currentRoom = null; render(el); };
  el.querySelector('#newItem')?.addEventListener('click', () => itemModal(() => renderRoom(el)));
  let timer;
  el.querySelector('#q').oninput = (e) => { search = e.target.value; clearTimeout(timer); timer = setTimeout(() => loadItems(el), 250); };
  loadItems(el);
}

async function loadItems(el) {
  const list = el.querySelector('#list');
  try {
    let q = supabase.from('items').select('*').order('name').limit(200);
    if (currentRoom !== 'ALL') q = q.eq('room_id', currentRoom);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`name.ilike.%${term}%,category.ilike.%${term}%,id.ilike.%${term}%`);
    const items = unwrap(await q);
    const ids = items.map((i) => i.id);
    const now = new Date().toISOString();
    const busyRows = ids.length ? unwrap(await supabase.from('rental_calendar').select('item_id, end_at, borrower_name, start_at')
      .in('item_id', ids).eq('status', 'active').lte('start_at', now)) : [];
    const rented = Object.fromEntries(busyRows.map((r) => [r.item_id, r]));

    if (!items.length) { list.innerHTML = '<p class="col-span-full py-8 text-center italic text-slate-400">Keine Objekte gefunden.</p>'; return; }
    list.innerHTML = items.map((i) => itemCard(i, rented[i.id])).join('');
    list.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => handleAction(b, items, () => loadItems(el))));
  } catch (e) { list.innerHTML = `<p class="text-red-600">${esc(e.message)}</p>`; }
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
  return `<article class="card flex gap-3">
    ${photo ? `<img src="${esc(photo)}" alt="" class="h-16 w-16 shrink-0 rounded-xl object-cover">` : '<div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl">📦</div>'}
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5"><h3 class="truncate font-bold">${esc(i.name)}</h3>${i.item_type === 'kit' ? '<span class="badge bg-purple-100 text-purple-700">KIT</span>' : ''}</div>
      <p class="text-xs text-slate-500">${esc(i.id)} · ${esc(i.room_id)}${loc ? ' · ' + esc(loc) : ''}</p>
      <div class="mt-1 flex items-center gap-2">${statusBadge(i, rental)}${rental ? `<span class="text-[11px] text-slate-500">bis ${fmtDateTime(rental.end_at)}</span>` : ''}</div>
      <div class="mt-2 flex flex-wrap gap-2">
        ${i.item_type === 'consumable' ? `<button data-act="consume" data-id="${esc(i.id)}" class="btn-primary !px-2.5 !py-1 !text-xs">Entnehmen</button>`
          : i.status === 'active' ? `<button data-act="rent" data-id="${esc(i.id)}" class="btn-primary !px-2.5 !py-1 !text-xs">Ausleihen</button>` : ''}
        ${manage && i.status === 'active' ? `<button data-act="status" data-status="maintenance" data-id="${esc(i.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">🛠 Defekt</button>` : ''}
        ${manage && i.status !== 'active' ? `<button data-act="status" data-status="active" data-id="${esc(i.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">✅ Freigeben</button>` : ''}
      </div>
    </div></article>`;
}

async function handleAction(btn, items, reload) {
  const item = items.find((i) => i.id === btn.dataset.id);
  if (btn.dataset.act === 'rent') return rentModal(item, reload);
  if (btn.dataset.act === 'consume') return consumeModal(item, reload);
  if (btn.dataset.act === 'status') {
    await busy(btn, async () => {
      unwrap(await supabase.rpc('set_item_status', { p_item_id: item.id, p_status: btn.dataset.status }));
      toast('Status aktualisiert', 'success'); reload();
    });
  }
}

async function rentModal(item, reload) {
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

function itemModal(done) {
  const { el, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">Neuer Artikel</h3>
    <form id="f" class="space-y-3">
      <div><label class="label">Bezeichnung</label><input name="name" class="input" required></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Raum</label><select name="room" class="input">${state.rooms.filter((r) => canManageRoom(r.id)).map((r) => `<option value="${esc(r.id)}" ${r.id === currentRoom ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        <div><label class="label">Typ</label><select name="type" class="input"><option value="standard">Standard</option><option value="kit">Kit / Koffer</option><option value="consumable">Verbrauchsmaterial</option></select></div>
      </div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Kategorie</label><input name="category" class="input"></div><div><label class="label">Bestand</label><input name="stock" type="number" min="0" value="1" class="input"></div></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Regal</label><input name="shelf" class="input"></div><div><label class="label">Fach</label><input name="compartment" class="input"></div></div>
      <div><label class="label">Zubehör (kommagetrennt)</label><input name="acc" class="input" placeholder="Akku, Ladekabel, Tasche"></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Speichern</button></div>
    </form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      unwrap(await supabase.from('items').insert({
        name: f.get('name').trim(), room_id: f.get('room'), item_type: f.get('type'), category: f.get('category').trim() || null,
        stock_quantity: Number(f.get('stock')) || 0, shelf: f.get('shelf').trim() || null, compartment: f.get('compartment').trim() || null,
        accessories: f.get('acc').split(',').map((s) => s.trim()).filter(Boolean),
      }));
      close(); toast('Artikel angelegt', 'success'); done();
    });
  };
}
