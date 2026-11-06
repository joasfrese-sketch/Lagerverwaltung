import { supabase } from '../lib/supabase.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';
import { MAX_PHOTOS, thumbUrl, uploadPhoto, removePhotos } from '../lib/photos.js';

// Fotos eines Artikels verwalten (bis zu 5): hinzufügen, Titelbild wählen, löschen
export function openPhotoManager(item, done) {
  let photos = Array.isArray(item.photos) ? [...item.photos] : [];
  const { el } = openModal(`
    <div class="mb-1 flex items-center justify-between"><h3 class="text-lg font-bold">📷 Fotos</h3><button data-close class="text-slate-400">✕</button></div>
    <p class="mb-3 text-sm text-slate-500">${esc(item.name)} · <span id="cnt"></span></p>
    <div id="grid" class="grid grid-cols-2 gap-3 sm:grid-cols-3"></div>
    <input id="fileIn" type="file" accept="image/*" multiple class="hidden">
    <input id="camIn" type="file" accept="image/*" capture="environment" class="hidden">
    <p id="msg" class="mt-2 min-h-[1rem] text-xs text-slate-500"></p>
    <button data-close class="btn-primary mt-2 w-full">Fertig</button>`, { wide: true, onClose: done });
  const grid = el.querySelector('#grid'); const msg = el.querySelector('#msg');

  const persist = async (arr) => {
    const { error } = await supabase.from('items').update({ photos: arr }).eq('id', item.id);
    if (error) throw new Error(error.message);
    photos = arr; item.photos = arr; draw();
  };

  function draw() {
    el.querySelector('#cnt').textContent = `${photos.length} von ${MAX_PHOTOS}`;
    grid.innerHTML = photos.map((u, i) => `
      <div class="relative overflow-hidden rounded-xl border"><img src="${esc(thumbUrl(u))}" alt="" class="aspect-square w-full object-cover">
        ${i === 0 ? '<span class="badge absolute left-1 top-1 bg-brand-600 text-white">Titelbild</span>' : ''}
        <div class="absolute inset-x-0 bottom-0 flex gap-1 bg-black/55 p-1">
          ${i > 0 ? `<button data-main="${i}" class="flex-1 rounded bg-white/90 px-1 py-0.5 text-[11px] font-semibold text-slate-800">★ Titelbild</button>` : ''}
          <button data-del="${i}" class="flex-1 rounded bg-red-600 px-1 py-0.5 text-[11px] font-semibold text-white">Löschen</button></div></div>`).join('')
      + (photos.length < MAX_PHOTOS ? `<div id="drop" class="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-2 text-center text-xs text-slate-500">
        <span>Bilder hierher ziehen</span><button data-pick class="btn-ghost !px-2.5 !py-1 !text-xs">📁 Auswählen</button><button data-cam class="btn-ghost !px-2.5 !py-1 !text-xs">📸 Aufnehmen</button></div>` : '');
    const drop = el.querySelector('#drop');
    if (drop) {
      drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('border-brand-500'); };
      drop.ondragleave = () => drop.classList.remove('border-brand-500');
      drop.ondrop = (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); };
    }
  }

  async function addFiles(fileList) {
    const room = MAX_PHOTOS - photos.length;
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return toast('Bitte Bilddateien wählen.', 'error');
    if (files.length > room) toast(`Nur noch ${room} Foto(s) möglich – der Rest wird ignoriert.`, 'info');
    const uploaded = [];
    try {
      for (const [n, f] of files.slice(0, room).entries()) {
        msg.textContent = `Lade Foto ${n + 1} von ${Math.min(files.length, room)} hoch…`;
        uploaded.push(await uploadPhoto(item, f));
      }
      await persist(photos.concat(uploaded));
      toast(`${uploaded.length} Foto(s) hinzugefügt`, 'success');
    } catch (e) {
      await removePhotos(uploaded);
      toast(e.message, 'error');
    } finally { msg.textContent = ''; }
  }

  grid.onclick = (e) => {
    const b = e.target.closest('[data-main],[data-del],[data-pick],[data-cam]');
    if (!b) return;
    if (b.dataset.pick !== undefined) return el.querySelector('#fileIn').click();
    if (b.dataset.cam !== undefined) return el.querySelector('#camIn').click();
    if (b.dataset.main !== undefined) {
      const i = Number(b.dataset.main); const arr = [photos[i], ...photos.filter((_, j) => j !== i)];
      return busy(b, () => persist(arr));
    }
    const i = Number(b.dataset.del); const url = photos[i];
    busy(b, async () => { await persist(photos.filter((_, j) => j !== i)); await removePhotos([url]); toast('Foto gelöscht', 'success'); });
  };
  const onPick = (e) => { addFiles(e.target.files); e.target.value = ''; };
  el.querySelector('#fileIn').onchange = onPick;
  el.querySelector('#camIn').onchange = onPick;
  draw();
}
