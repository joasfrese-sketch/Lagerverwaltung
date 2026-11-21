import { esc, fmtDateTime } from '../lib/ui.js';
import { thumbUrl } from '../lib/photos.js';
import { canManageRoom } from '../state.js';
import { inspectionState } from './inspection.js';
import { isBorrowable, itemStatus } from '../lib/rules.js';

const TONE = { ok: 'bg-emerald-100 text-emerald-900', warn: 'bg-amber-100 text-amber-900', bad: 'bg-red-100 text-red-800', info: 'bg-blue-100 text-blue-800' };
// Linker Randstreifen: Status ist an Farbe UND Symbol/Text erkennbar
const STRIPE = { ok: 'border-l-emerald-500', warn: 'border-l-amber-500', bad: 'border-l-red-500', info: 'border-l-blue-500' };

export function statusBadge(i, rental) {
  const s = itemStatus(i, rental);
  return `<span class="badge ${TONE[s.tone]}"><span aria-hidden="true">${s.icon}</span> ${esc(s.label)}</span>`;
}

/** Karte eines Artikels. ctx: { selectMode, selected, waiting } */
export function itemCard(i, rental, ctx) {
  const { selectMode, selected, waiting } = ctx;
  const photo = Array.isArray(i.photos) && i.photos[0];
  const selectable = canManageRoom(i.room_id) || isBorrowable(i);
  const loc = [i.shelf, i.compartment].filter(Boolean).join(' · ');
  const insp = inspectionState(i);
  const small = '!px-2.5 !py-1 !text-xs';
  const rentable = i.item_type !== 'consumable' && (rental || i.status !== 'active');
  const tone = itemStatus(i, rental).tone;
  const actions = `
        ${i.item_type === 'consumable' ? `<button data-act="consume" data-id="${esc(i.id)}" class="btn-primary ${small}">Entnehmen</button>`
          : i.status === 'active' ? `<button data-act="rent" data-id="${esc(i.id)}" class="btn-primary ${small}">Ausleihen</button>` : ''}
        ${rentable ? `<button data-act="wait" data-id="${esc(i.id)}" class="btn-ghost ${small}">${waiting ? '🔔 Benachrichtigung aktiv ✓' : '🔔 Benachrichtigen'}</button>` : ''}
`;
  const more = selectMode ? '' : `<button data-act="more" data-id="${esc(i.id)}" class="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-base font-bold leading-none text-slate-600 hover:bg-slate-200" aria-label="Weitere Aktionen für ${esc(i.name)}">⋯</button>`;
  return `<article data-card="${esc(i.id)}" class="card relative flex gap-3 border-l-4 ${STRIPE[tone]} ${selectMode ? 'cursor-pointer' : ''} ${selected ? 'ring-2 ring-brand-500' : ''} ${selectMode && !selectable ? 'opacity-50' : ''}">
    ${selectMode ? `<input type="checkbox" tabindex="-1" aria-label="${esc(i.name)} auswählen" ${selected ? 'checked' : ''} ${selectable ? '' : 'disabled'} class="mt-1 h-5 w-5 shrink-0 rounded text-brand-600">` : ''}
    ${photo ? `<div class="relative h-16 w-16 shrink-0"><img ${selectMode ? '' : `data-act="gallery" data-id="${esc(i.id)}" tabindex="0" role="button"`} src="${esc(thumbUrl(photo))}" alt="Foto von ${esc(i.name)}" loading="lazy" decoding="async" class="h-16 w-16 rounded-xl object-cover ${selectMode ? '' : 'cursor-zoom-in'}">${i.photos.length > 1 ? `<span class="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 text-[13px] font-bold text-white">${i.photos.length}</span>` : ''}</div>` : '<div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-2xl" aria-hidden="true">📦</div>'}
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5 pr-10"><h3 class="truncate font-bold">${esc(i.name)}</h3>${i.item_type === 'kit' ? '<span class="badge bg-purple-100 text-purple-800">KIT</span>' : ''}</div>
      <p class="text-xs text-slate-500">${esc(i.id)} · ${esc(i.room_id)}${loc ? ' · ' + esc(loc) : ''}</p>
      <div class="mt-1 flex flex-wrap items-center gap-2">${statusBadge(i, rental)}${rental ? `<span class="text-[13px] text-slate-500">bis ${fmtDateTime(rental.end_at)}</span>` : ''}${insp && insp.level !== 'ok' ? `<span class="badge ${insp.level === 'due' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}">🔧 ${esc(insp.text)}</span>` : ''}</div>
      ${selectMode ? '' : `<div class="mt-2 flex flex-wrap gap-2">${actions}</div>`}
    </div>${more}</article>`;
}
