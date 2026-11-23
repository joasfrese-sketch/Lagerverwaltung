// Ein-/ausklappbare Bereiche (native <details>, funktioniert auch ohne JavaScript-Logik).
// Der Zustand wird pro Gerät gemerkt (localStorage); `open` ist nur der Startwert beim ersten Besuch.
// title/hint sind vertrauenswürdiges HTML – dynamische Texte vorher mit esc() maskieren.
import { esc } from '../lib/ui.js';

const KEY = 'ui_sections';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* egal */ } };
export const isOpen = (id, dflt = false) => { const v = read()[id]; return v === undefined ? !!dflt : !!v; };

export function collapsible({ id, title, hint = '', count = null, countCls = 'bg-slate-100 text-slate-600', open = false, body = '', cls = '' }) {
  return `<details data-collapse="${esc(id)}" id="sec-${esc(id)}" class="card group !p-0 ${cls}" ${isOpen(id, open) ? 'open' : ''}>
    <summary class="flex cursor-pointer select-none list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
      <span class="min-w-0 flex-1"><span class="block text-sm font-bold">${title}</span>${hint ? `<span class="block truncate text-xs font-normal text-slate-500">${hint}</span>` : ''}</span>
      ${count === null ? '' : `<span data-count class="badge ${countCls}">${count}</span>`}
      <svg class="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </summary>
    <div class="border-t border-slate-100 px-4 pb-4 pt-3">${body}</div></details>`;
}

// Merkt nur echte Klicks des Nutzers (nicht den Startzustand)
export function bindCollapsibles(root) {
  root.querySelectorAll('details[data-collapse]').forEach((d) => {
    d.querySelector('summary').addEventListener('click', () => setTimeout(() => { const o = read(); o[d.dataset.collapse] = d.open; write(o); }, 0));
  });
}

export function setCount(root, id, n, cls) {
  const b = root.querySelector(`#sec-${id} [data-count]`);
  if (!b) return;
  b.textContent = n;
  if (cls) b.className = `badge ${cls}`;
}

export function openSection(root, id) {
  const d = root.querySelector(`#sec-${id}`);
  if (!d) return false;
  d.open = true;
  const o = read(); o[id] = true; write(o);
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
