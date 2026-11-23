import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';
import { state, canManageRoom } from '../state.js';
import { openImportWizard } from './importWizard.js';
import { uploadPhoto, removePhotos } from '../lib/photos.js';
import { MAX_PHOTOS } from '../lib/rules.js';
import { intervalSelect } from './inspection.js';

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
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Erforderliche Berechtigung (optional)</label><input name="perm" class="input" placeholder="z. B. Kamera-Schein"></div>
        <div><label class="label">Prüfintervall</label>${intervalSelect(null)}</div></div>
      <div><label class="label">Fotos (bis zu ${MAX_PHOTOS})</label>
        <div id="thumbs" class="mb-2 flex flex-wrap gap-2"></div>
        <div class="flex flex-wrap gap-2"><label class="btn-ghost cursor-pointer">📸 Foto aufnehmen<input id="camIn" type="file" accept="image/*" capture="environment" class="hidden"></label>
          <label class="btn-ghost cursor-pointer">🖼️ Aus Galerie<input id="galIn" type="file" accept="image/*" multiple class="hidden"></label></div></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary" value="save">Speichern</button></div></form>`);
  // Fotos schon beim Anlegen wählen; hochgeladen wird erst nach dem Speichern
  const picked = []; // { file, url }
  const drawThumbs = () => {
    el.querySelector('#thumbs').innerHTML = picked.map((p, i) => `<div class="relative"><img src="${esc(p.url)}" alt="Vorschau ${i + 1}" class="h-16 w-16 rounded-xl object-cover"><button type="button" data-rm="${i}" aria-label="Foto ${i + 1} entfernen" class="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs text-white">✕</button></div>`).join('');
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { URL.revokeObjectURL(picked[b.dataset.rm].url); picked.splice(Number(b.dataset.rm), 1); drawThumbs(); }));
  };
  const addFiles = (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/')); e.target.value = '';
    const room = MAX_PHOTOS - picked.length;
    if (files.length > room) toast(`Höchstens ${MAX_PHOTOS} Fotos – ${files.length - room} ignoriert.`, 'info');
    files.slice(0, room).forEach((file) => picked.push({ file, url: URL.createObjectURL(file) }));
    drawThumbs();
  };
  el.querySelector('#camIn').onchange = addFiles; el.querySelector('#galIn').onchange = addFiles;
  el.querySelector('#xl').onclick = () => { close(); openImportWizard({ defaultRoom, done }); };
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    busy(e.submitter || e.target.querySelector('.btn-primary'), async () => {
      const created = unwrap(await supabase.from('items').insert({
        name: f.get('name').trim(), room_id: f.get('room'), item_type: f.get('type'), category: f.get('category').trim() || null,
        stock_quantity: Number(f.get('stock')) || 0, shelf: f.get('shelf').trim() || null, compartment: f.get('compartment').trim() || null,
        accessories: f.get('acc').split(',').map((s) => s.trim()).filter(Boolean), required_permission: f.get('perm').trim() || null,
        inspection_interval_months: f.get('interval') ? Number(f.get('interval')) : null,
      }).select().single());
      // Fotos hochladen; schlägt das fehl, bleibt der Artikel trotzdem angelegt
      const urls = []; let photoError = null;
      for (const p of picked) { try { urls.push(await uploadPhoto(created, p.file)); } catch (err) { photoError = err; break; } }
      if (urls.length) {
        const { error } = await supabase.from('items').update({ photos: urls }).eq('id', created.id);
        if (error) { await removePhotos(urls); photoError = error; }
      }
      picked.forEach((p) => URL.revokeObjectURL(p.url));
      close(); done();
      if (photoError) toast(`Artikel angelegt, aber Fotos fehlen: ${photoError.message}. Bitte über ⋯ → Fotos erneut versuchen.`, 'error');
      else toast(urls.length ? `Artikel mit ${urls.length} Foto(s) angelegt` : 'Artikel angelegt', 'success');
    });
  };
}
