import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';
import { state, canManageRoom } from '../state.js';
import { openImportWizard } from './importWizard.js';

// "Neuer Artikel" einzeln anlegen; Excel-Import über eigenen Dialog
export function openNewItem({ defaultRoom, done }) {
  const rooms = state.rooms.filter((r) => canManageRoom(r.id));
  const { el, close } = openModal(`
    <div class="mb-3 flex items-center justify-between gap-2"><h3 class="text-lg font-bold">Neuer Artikel</h3><button id="xl" type="button" class="btn-ghost !py-1.5">📊 Aus Excel importieren</button></div>
    <form id="f" class="space-y-3">
      <div><label class="label">Bezeichnung</label><input name="name" class="input" required></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">Raum</label><select name="room" class="input">${rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === defaultRoom ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        <div><label class="label">Typ</label><select name="type" class="input"><option value="standard">Standard</option><option value="kit">Kit / Koffer</option><option value="consumable">Verbrauchsmaterial</option></select></div></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Kategorie</label><input name="category" class="input"></div><div><label class="label">Bestand</label><input name="stock" type="number" min="0" value="1" class="input"></div></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Regal</label><input name="shelf" class="input"></div><div><label class="label">Fach</label><input name="compartment" class="input"></div></div>
      <div><label class="label">Zubehör (kommagetrennt)</label><input name="acc" class="input" placeholder="Akku, Ladekabel, Tasche"></div>
      <div><label class="label">Erforderliche Berechtigung (optional)</label><input name="perm" class="input" placeholder="z. B. Kamera-Schein"></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Speichern</button></div></form>`);
  el.querySelector('#xl').onclick = () => { close(); openImportWizard({ defaultRoom, done }); };
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      unwrap(await supabase.from('items').insert({
        name: f.get('name').trim(), room_id: f.get('room'), item_type: f.get('type'), category: f.get('category').trim() || null,
        stock_quantity: Number(f.get('stock')) || 0, shelf: f.get('shelf').trim() || null, compartment: f.get('compartment').trim() || null,
        accessories: f.get('acc').split(',').map((s) => s.trim()).filter(Boolean), required_permission: f.get('perm').trim() || null,
      }));
      close(); toast('Artikel angelegt', 'success'); done();
    });
  };
}
