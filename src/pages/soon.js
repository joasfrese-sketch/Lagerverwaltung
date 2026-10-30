import { esc } from '../lib/ui.js';
export function render(el, { title, text }) {
  el.innerHTML = `<div class="card py-16 text-center"><div class="text-4xl">🚧</div><h2 class="mt-3 text-xl font-bold">${esc(title)}</h2><p class="mx-auto mt-1 max-w-sm text-sm text-slate-500">${esc(text)}</p><p class="mt-4 text-xs text-slate-400">Wird im nächsten Entwicklungsschritt gebaut.</p></div>`;
}
