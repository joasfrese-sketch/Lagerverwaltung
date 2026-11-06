import { esc, openModal } from '../lib/ui.js';
import { thumbUrl } from '../lib/photos.js';

// Großansicht aller Fotos eines Artikels (Pfeiltasten, Wischen, Vorschaubilder)
export function openGallery(item, start = 0) {
  const photos = Array.isArray(item.photos) ? item.photos : [];
  if (!photos.length) return;
  let i = Math.min(start, photos.length - 1);
  const onKey = (e) => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); };
  const { el } = openModal(`
    <div class="mb-2 flex items-center justify-between"><h3 class="truncate font-bold">${esc(item.name)}</h3><button data-close class="text-slate-400">✕</button></div>
    <div class="relative"><img id="big" alt="" class="max-h-[65vh] w-full rounded-xl bg-slate-100 object-contain">
      ${photos.length > 1 ? '<button id="prev" class="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-1 text-xl text-white">‹</button><button id="next" class="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-1 text-xl text-white">›</button>' : ''}</div>
    <div class="mt-2 flex items-center justify-between"><span id="cap" class="text-xs text-slate-500"></span></div>
    ${photos.length > 1 ? `<div class="mt-2 flex gap-2 overflow-x-auto">${photos.map((u, n) => `<img data-t="${n}" src="${esc(thumbUrl(u))}" alt="" class="h-14 w-14 shrink-0 cursor-pointer rounded-lg object-cover">`).join('')}</div>` : ''}`,
  { wide: true, onClose: () => document.removeEventListener('keydown', onKey) });
  const big = el.querySelector('#big');
  function show() {
    big.src = photos[i];
    el.querySelector('#cap').textContent = `Foto ${i + 1} von ${photos.length}`;
    el.querySelectorAll('[data-t]').forEach((t) => t.classList.toggle('ring-2', Number(t.dataset.t) === i));
    el.querySelectorAll('[data-t]').forEach((t) => t.classList.toggle('ring-brand-500', Number(t.dataset.t) === i));
  }
  function go(d) { i = (i + d + photos.length) % photos.length; show(); }
  el.querySelector('#prev')?.addEventListener('click', () => go(-1));
  el.querySelector('#next')?.addEventListener('click', () => go(1));
  el.querySelectorAll('[data-t]').forEach((t) => (t.onclick = () => { i = Number(t.dataset.t); show(); }));
  let x0 = null;
  big.ontouchstart = (e) => { x0 = e.touches[0].clientX; };
  big.ontouchend = (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); x0 = null; };
  document.addEventListener('keydown', onKey);
  show();
}
