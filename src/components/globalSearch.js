import { supabase, safeData } from '../lib/supabase.js';
import { esc, openModal } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { displayName } from '../lib/format.js';
import { isManager } from '../state.js';
import { openRoom } from '../pages/catalog.js';

const PAGES = [['uebersicht', 'Übersicht', 'home'], ['katalog', 'Katalog', 'package'], ['kalender', 'Kalender', 'calendar'], ['chat', 'Chat & Mitteilungen', 'chat'],
  ['ich', 'Mein Bereich', 'user'], ['einstellungen', 'Einstellungen', 'settings'], ['terminal', 'Lagerwart-Terminal', 'shield', true], ['protokoll', 'Protokoll', 'file', true]];
const go = (hash) => { location.hash = hash; window.dispatchEvent(new Event('hashchange')); };
const state = (i) => (i.rented_now ? 'ausgeliehen' : i.status === 'maintenance' ? 'defekt' : i.status === 'inventory' ? 'in Inventur' : 'verfügbar');
let open = false;

// Befehlspalette (Strg+K): Artikel aller Räume, Seiten und (für Verantwortliche) Personen
export function openGlobalSearch() {
  if (open) return;
  open = true;
  let results = []; let idx = 0; let seq = 0;
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, results.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
    else if (e.key === 'Enter' && results[idx]) { e.preventDefault(); const r = results[idx]; close(); r.run(); }
  };
  const { el, close } = openModal(`
    <div class="flex items-center gap-2 rounded-xl border border-slate-200 px-3">${icon('search', 'h-5 w-5 text-slate-400')}
      <input id="gq" class="w-full bg-transparent py-3 text-sm outline-none" placeholder="Artikel, Seite${isManager() ? ' oder Person' : ''} suchen…" autocomplete="off" autofocus></div>
    <div id="gr" class="mt-3 max-h-80 space-y-1 overflow-y-auto"></div>
    <p class="mt-3 text-[11px] text-slate-400">↑↓ wählen · Enter öffnen · Esc schließen</p>`, { onClose: () => { open = false; document.removeEventListener('keydown', onKey); } });
  document.addEventListener('keydown', onKey);
  const box = el.querySelector('#gr'); const input = el.querySelector('#gq');

  function draw() {
    box.innerHTML = results.length ? results.map((r, i) => `<button data-i="${i}" class="flex w-full items-center gap-3 rounded-xl p-2.5 text-left text-sm ${i === idx ? 'bg-brand-50 ring-1 ring-brand-500' : 'hover:bg-slate-100'}">
      <span class="text-slate-500">${r.icon}</span><span class="min-w-0 flex-1"><b class="block truncate">${esc(r.label)}</b>${r.sub ? `<span class="block truncate text-xs text-slate-500">${esc(r.sub)}</span>` : ''}</span><span class="text-[10px] uppercase text-slate-400">${r.kind}</span></button>`).join('')
      : '<p class="p-4 text-center text-sm italic text-slate-400">Keine Treffer.</p>';
    box.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { const r = results[Number(b.dataset.i)]; close(); r.run(); }));
    box.querySelector('.ring-1')?.scrollIntoView({ block: 'nearest' });
  }

  async function search(term) {
    const my = ++seq; const t = term.trim().replace(/[%,()]/g, ' ');
    const pages = PAGES.filter(([, label, , mgr]) => (!mgr || isManager()) && (!t || label.toLowerCase().includes(t.toLowerCase())))
      .map(([k, label, ic]) => ({ kind: 'Seite', icon: icon(ic, 'h-5 w-5'), label, run: () => go(`#/${k}`) }));
    let items = []; let people = [];
    if (t.length >= 1) {
      items = await safeData(supabase.from('catalog_items').select('id, name, room_id, category, status, rented_now').or(`name.ilike.%${t}%,category.ilike.%${t}%,id.ilike.%${t}%`).order('name').limit(8));
      if (isManager()) people = await safeData(supabase.from('public_profiles').select('id, full_name, username').or(`full_name.ilike.%${t}%,username.ilike.%${t}%`).limit(5));
    }
    if (my !== seq) return; // veraltete Antwort verwerfen
    results = [
      ...items.map((i) => ({ kind: 'Artikel', icon: icon('package', 'h-5 w-5'), label: i.name, sub: `${i.id} · ${i.room_id} · ${state(i)}`, run: () => { openRoom(i.room_id, i.name); go('#/katalog'); } })),
      ...people.map((p) => ({ kind: 'Person', icon: icon('user', 'h-5 w-5'), label: displayName(p), sub: `@${p.username} → im Terminal öffnen`, run: () => go(`#/terminal?user=${p.id}`) })),
      ...pages,
    ];
    idx = 0; draw();
  }
  let timer; input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => search(input.value), 180); };
  search('');
}
