import { esc } from '../lib/ui.js';

/** Leerer Zustand mit Erklärung und nächstem Schritt.
 * actions: [{ id, label, primary? }] – die Knöpfe werden mit data-empty="<id>" gerendert; Klicks bindet der Aufrufer. */
export function emptyState({ icon = '📭', title, text = '', actions = [] }) {
  return `<div class="col-span-full rounded-2xl border border-dashed border-slate-300 p-6 text-center" role="status">
    <div class="text-4xl" aria-hidden="true">${icon}</div>
    <h3 class="mt-2 font-bold">${esc(title)}</h3>
    ${text ? `<p class="mx-auto mt-1 max-w-sm text-sm text-slate-500">${esc(text)}</p>` : ''}
    ${actions.length ? `<div class="mt-4 flex flex-wrap justify-center gap-2">${actions.map((a) => `<button type="button" data-empty="${esc(a.id)}" class="${a.primary ? 'btn-primary' : 'btn-ghost'}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
}

/** Bindet die Knöpfe eines leeren Zustands: handlers = { id: fn } */
export function bindEmpty(root, handlers) {
  root.querySelectorAll('[data-empty]').forEach((b) => (b.onclick = () => handlers[b.dataset.empty]?.()));
}
