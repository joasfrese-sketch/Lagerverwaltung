import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';
import { state, canManageRoom } from '../state.js';
import { openPhotoManager } from './photoManager.js';
import { removePhotos } from '../lib/photos.js';

const chunk = (arr, n = 100) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const roomOptions = (sel) => state.rooms.filter((r) => canManageRoom(r.id)).map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
const TYPES = [['standard', 'Standard'], ['kit', 'Kit / Koffer'], ['consumable', 'Verbrauchsmaterial']];
const STATUS = [['active', '✅ Verfügbar'], ['maintenance', '🛠 Defekt / Wartung'], ['inventory', '📋 In Inventur']];

// ---------- Einzelnen Artikel bearbeiten ----------
export function openEditItem(item, done) {
  const { el, close } = openModal(`
    <div class="flex items-center justify-between gap-2"><h3 class="text-lg font-bold">Artikel bearbeiten</h3><button id="ph" type="button" class="btn-ghost !py-1.5">📷 Fotos (${(item.photos || []).length}/5)</button></div><p class="mb-3 font-mono text-xs text-slate-400">${esc(item.id)}</p>
    <form id="f" class="space-y-3">
      <div><label class="label">Bezeichnung</label><input name="name" class="input" value="${esc(item.name)}" required></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Raum</label><select name="room" class="input">${roomOptions(item.room_id)}</select></div>
        <div><label class="label">Typ</label><select name="type" class="input">${TYPES.map(([v, l]) => `<option value="${v}" ${item.item_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="grid grid-cols-3 gap-2">
        <div><label class="label">Kategorie</label><input name="category" class="input" value="${esc(item.category)}"></div>
        <div><label class="label">Bestand</label><input name="stock" type="number" min="0" class="input" value="${item.stock_quantity}"></div>
        <div><label class="label">Mindestbest.</label><input name="min" type="number" min="0" class="input" value="${item.min_stock}"></div></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Regal</label><input name="shelf" class="input" value="${esc(item.shelf)}"></div><div><label class="label">Fach</label><input name="compartment" class="input" value="${esc(item.compartment)}"></div></div>
      <div><label class="label">Zubehör (kommagetrennt)</label><input name="acc" class="input" value="${esc((item.accessories || []).join(', '))}"></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Erforderliche Berechtigung</label><input name="perm" class="input" value="${esc(item.required_permission)}"></div>
        <div><label class="label">Status</label><select name="status" class="input">${STATUS.map(([v, l]) => `<option value="${v}" ${item.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Speichern</button></div></form>`);
  el.querySelector('#ph').onclick = () => openPhotoManager(item, () => { el.querySelector('#ph').textContent = `📷 Fotos (${(item.photos || []).length}/5)`; });
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      unwrap(await supabase.from('items').update({
        name: f.get('name').trim(), room_id: f.get('room'), item_type: f.get('type'), category: f.get('category').trim() || null,
        stock_quantity: Number(f.get('stock')) || 0, min_stock: Number(f.get('min')) || 0, shelf: f.get('shelf').trim() || null, compartment: f.get('compartment').trim() || null,
        accessories: f.get('acc').split(',').map((s) => s.trim()).filter(Boolean), required_permission: f.get('perm').trim() || null, status: f.get('status'),
      }).eq('id', item.id));
      close(); toast('Gespeichert', 'success'); done();
    });
  };
}

// ---------- Mehrere Artikel gleichzeitig bearbeiten ----------
export function openBulkEdit(items, done) {
  const rows = [
    ['room', 'Raum', `<select name="room" class="input">${roomOptions('')}</select>`],
    ['category', 'Kategorie', '<input name="category" class="input" placeholder="leer = Kategorie entfernen">'],
    ['type', 'Typ', `<select name="type" class="input">${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`],
    ['shelf', 'Regal', '<input name="shelf" class="input" placeholder="leer = entfernen">'],
    ['compartment', 'Fach', '<input name="compartment" class="input" placeholder="leer = entfernen">'],
    ['perm', 'Berechtigung', '<input name="perm" class="input" placeholder="leer = keine Berechtigung nötig">'],
    ['min', 'Mindestbestand', '<input name="min" type="number" min="0" class="input" value="0">'],
    ['status', 'Status', `<select name="status" class="input">${STATUS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`],
  ];
  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">${items.length} Artikel bearbeiten</h3>
    <p class="mb-3 text-xs text-slate-500">Setze den Haken bei jedem Feld, das für <b>alle</b> ausgewählten Artikel geändert werden soll. Alles andere bleibt unverändert.</p>
    <form id="f" class="space-y-2">${rows.map(([k, label, input]) => `<div class="grid grid-cols-[1.5rem_8rem_1fr] items-center gap-2"><input type="checkbox" name="use_${k}"><span class="text-sm font-semibold">${label}</span>${input}</div>`).join('')}
      <div class="flex justify-end gap-2 pt-3"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Änderungen anwenden</button></div></form>`);
  // Feld automatisch anhaken, sobald man es ändert
  el.querySelectorAll('input:not([type=checkbox]), select').forEach((c) => c.addEventListener('input', () => { const cb = el.querySelector(`[name="use_${c.name}"]`); if (cb) cb.checked = true; }));
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target); const on = (k) => f.get(`use_${k}`) === 'on';
    const patch = {};
    if (on('room')) patch.room_id = f.get('room');
    if (on('category')) patch.category = f.get('category').trim() || null;
    if (on('type')) patch.item_type = f.get('type');
    if (on('shelf')) patch.shelf = f.get('shelf').trim() || null;
    if (on('compartment')) patch.compartment = f.get('compartment').trim() || null;
    if (on('perm')) patch.required_permission = f.get('perm').trim() || null;
    if (on('min')) patch.min_stock = Number(f.get('min')) || 0;
    const status = on('status') ? f.get('status') : null;
    if (!Object.keys(patch).length && !status) return toast('Kein Feld zum Ändern ausgewählt.', 'error');
    busy(e.target.querySelector('.btn-primary'), async () => {
      const ids = items.map((i) => i.id);
      if (Object.keys(patch).length) for (const part of chunk(ids)) unwrap(await supabase.from('items').update(patch).in('id', part));
      if (status) for (const part of chunk(ids)) unwrap(await supabase.rpc('bulk_set_item_status', { p_ids: part, p_status: status }));
      close(); toast(`${items.length} Artikel aktualisiert`, 'success'); done();
    });
  };
}

// ---------- Löschen (mit Sicherheitsabfrage) ----------
export async function deleteItems(items, done) {
  if (!items.length) return;
  let active = [];
  try {
    for (const part of chunk(items.map((i) => i.id))) active = active.concat(unwrap(await supabase.from('rentals').select('item_id').in('item_id', part).eq('status', 'active')).map((r) => r.item_id));
  } catch (e) { return toast(e.message, 'error'); }
  const blocked = items.filter((i) => active.includes(i.id));
  const deletable = items.filter((i) => !active.includes(i.id));
  if (!deletable.length) {
    return openModal(`<h3 class="mb-2 text-lg font-bold text-red-600">Nicht löschbar</h3><p class="mb-3 text-sm">Diese Artikel sind noch ausgeliehen. Bitte zuerst zurücknehmen:</p>
      <ul class="mb-3 space-y-1 text-sm">${blocked.slice(0, 10).map((i) => `<li class="rounded-xl bg-red-50 p-2">${esc(i.name)} <span class="font-mono text-xs">${esc(i.id)}</span></li>`).join('')}</ul><button data-close class="btn-primary w-full">OK</button>`);
  }
  const { el, close } = openModal(`
    <h3 class="mb-2 text-lg font-bold text-red-600">${deletable.length} Artikel endgültig löschen?</h3>
    ${blocked.length ? `<p class="mb-2 rounded-xl bg-amber-50 p-2 text-xs text-amber-800">${blocked.length} ausgeliehene Artikel werden übersprungen.</p>` : ''}
    <ul class="mb-3 max-h-40 space-y-1 overflow-y-auto text-sm">${deletable.slice(0, 12).map((i) => `<li class="rounded-lg bg-slate-50 p-1.5">${esc(i.name)} <span class="font-mono text-xs text-slate-400">${esc(i.id)}</span></li>`).join('')}${deletable.length > 12 ? `<li class="text-xs text-slate-400">… und ${deletable.length - 12} weitere</li>` : ''}</ul>
    <p class="mb-3 text-xs text-slate-500">Auch die Ausleih-Historie dieser Artikel wird gelöscht. Protokolleinträge bleiben erhalten. Das kann nicht rückgängig gemacht werden.</p>
    <label class="mb-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" id="ok"> Ja, endgültig löschen</label>
    <div class="flex justify-end gap-2"><button data-close class="btn-ghost">Abbrechen</button><button id="del" class="btn-danger" disabled>🗑 Löschen</button></div>`);
  el.querySelector('#ok').onchange = (e) => (el.querySelector('#del').disabled = !e.target.checked);
  el.querySelector('#del').onclick = (e) => busy(e.target, async () => {
    let n = 0;
    try { for (const part of chunk(deletable.map((i) => i.id))) { unwrap(await supabase.from('items').delete().in('id', part)); n += part.length; } }
    catch (err) { throw new Error(`Nach ${n} gelöschten Artikeln abgebrochen: ${err.message}`); }
    await removePhotos(deletable.flatMap((i) => i.photos || []));
    close(); toast(`${n} Artikel gelöscht`, 'success'); done();
  });
}
