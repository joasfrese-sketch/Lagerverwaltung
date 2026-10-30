import { supabase } from '../lib/supabase.js';
import { esc } from '../lib/ui.js';
import { state, isManager } from '../state.js';
import { signOut } from '../auth.js';
import { openScanner, routeScan } from './scanner.js';
import * as overview from '../pages/overview.js';
import * as catalog from '../pages/catalog.js';
import * as calendar from '../pages/calendar.js';
import * as chat from '../pages/chat.js';
import * as me from '../pages/me.js';
import * as settings from '../pages/settings.js';
import * as terminal from '../pages/terminal.js';

const ALL_ROUTES = {
  uebersicht: { label: 'Übersicht', short: 'Start', icon: '🏠', page: overview },
  katalog: { label: 'Katalog', short: 'Katalog', icon: '📦', page: catalog },
  kalender: { label: 'Kalender', short: 'Kalender', icon: '📅', page: calendar },
  chat: { label: 'Chat & Mitteilungen', short: 'Chat', icon: '💬', page: chat, badge: true },
  ich: { label: 'Mein Bereich', short: 'Ich', icon: '👤', page: me },
  terminal: { label: 'Lagerwart-Terminal', short: 'Lagerwart', icon: '🛡️', page: terminal, managerOnly: true },
  einstellungen: { label: 'Einstellungen', short: 'Mehr', icon: '⚙️', page: settings },
};

let hashHandler = null;
let unmount = null;

export function renderShell(root) {
  const routes = Object.entries(ALL_ROUTES).filter(([, r]) => !r.managerOnly || isManager());
  root.innerHTML = `
  <div class="flex min-h-screen">
    <aside class="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between bg-[#0f172a] p-4 text-[#cbd5e1] md:flex">
      <div>
        <div class="mb-6 flex items-center gap-3 px-2"><span class="text-2xl">📦</span><span class="font-bold text-white">Lager Pro</span></div>
        <button id="scanBtn" class="mb-4 w-full rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-brand-700">📷 Scannen</button>
        <nav class="space-y-1" id="sideNav">
          ${routes.map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-[#1e293b]"><span>${r.icon}</span>${esc(r.label)}${r.badge ? '<span data-badge class="ml-auto hidden rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white"></span>' : ''}</a>`).join('')}
        </nav>
      </div>
      <div class="flex items-center justify-between rounded-xl bg-[#1e293b] p-3">
        <div class="min-w-0"><div class="truncate text-xs font-bold text-white">${esc(state.profile.full_name || state.profile.username)}</div><div class="text-[10px] uppercase tracking-wider text-[#94a3b8]">${esc(roleLabel())}</div></div>
        <button id="logoutBtn" title="Abmelden" class="text-[#94a3b8] hover:text-white">⎋</button>
      </div>
    </aside>
    <main class="min-w-0 flex-1 pb-24 md:pb-8"><div id="page" class="mx-auto max-w-5xl p-4 md:p-8"></div></main>
    <button id="scanFab" class="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-xl text-white shadow-lg md:hidden" title="Scannen">📷</button>
    <nav class="fixed inset-x-0 bottom-0 z-40 grid border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" id="tabBar" style="grid-template-columns:repeat(${routes.length},minmax(0,1fr))">
      ${routes.map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="relative flex flex-col items-center py-2 text-[10px] font-semibold text-slate-500"><span class="text-lg">${r.icon}</span>${esc(r.short)}${r.badge ? '<span data-badge class="absolute right-2 top-1 hidden rounded-full bg-red-500 px-1.5 text-[9px] font-bold text-white"></span>' : ''}</a>`).join('')}
    </nav>
  </div>`;
  root.querySelector('#logoutBtn').onclick = signOut;
  const scan = () => openScanner(routeScan);
  root.querySelector('#scanBtn').onclick = scan;
  root.querySelector('#scanFab').onclick = scan;

  const go = async () => {
    if (unmount) { try { unmount(); } catch { /* ignore */ } unmount = null; }
    const key = (location.hash.replace('#/', '') || 'uebersicht').split('?')[0];
    const entry = routes.find(([k]) => k === key) || routes[0];
    const [activeKey, route] = entry;
    root.querySelectorAll('[data-route]').forEach((a) => {
      const active = a.dataset.route === activeKey;
      const side = !!a.closest('#sideNav');
      if (side) { a.classList.toggle('bg-[#1e293b]', active); a.classList.toggle('text-white', active); }
      else { a.classList.toggle('text-brand-600', active); a.classList.toggle('text-slate-500', !active); }
    });
    const container = root.querySelector('#page');
    container.innerHTML = '';
    try {
      await route.page.render(container);
      unmount = route.page.unmount || null;
    } catch (e) {
      container.innerHTML = `<div class="card text-red-600">Seite konnte nicht geladen werden: ${esc(e.message)}</div>`;
    }
    window.scrollTo(0, 0);
  };
  if (hashHandler) window.removeEventListener('hashchange', hashHandler);
  hashHandler = go;
  window.addEventListener('hashchange', go);
  go();
  watchNotifications(root);
}

function roleLabel() {
  const p = state.profile;
  if (p.role === 'admin') return 'Administrator';
  if (p.role === 'raum_manager') return `Raum-Manager${p.managed_room ? ' · ' + p.managed_room : ''}`;
  return 'Benutzer';
}

// Badge ungelesener Mitteilungen (Realtime)
async function watchNotifications(root) {
  const refresh = async () => {
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    root.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = count > 99 ? '99+' : count || ''; b.classList.toggle('hidden', !count); });
  };
  refresh();
  window.addEventListener('notifications-changed', refresh);
  supabase.channel('notif-badge')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.user.id}` }, refresh)
    .subscribe();
}
