import { openModal, esc } from '../lib/ui.js';

// Auswahlmenü (unten eingeblendet auf dem Handy): items = [{ label, run, danger? }]
export function openSheet(title, items) {
  const { el, close } = openModal(`<h3 class="mb-2 text-base font-bold">${esc(title)}</h3>
    <div class="space-y-0.5">${items.map((it, i) => `<button data-i="${i}" class="flex w-full items-center gap-3 rounded-xl p-3 text-left text-sm font-semibold hover:bg-slate-100 ${it.danger ? 'text-red-600' : ''}">${it.label}</button>`).join('')}</div>
    <button data-close class="btn-ghost mt-2 w-full">Abbrechen</button>`);
  el.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { close(); items[Number(b.dataset.i)].run(); }));
}
