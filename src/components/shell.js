import { supabase } from '../lib/supabase.js';
import { esc, openModal } from '../lib/ui.js';
import { icon } from '../lib/icons.js';
import { logoMark } from '../lib/logo.js';
import { roleName, displayName } from '../lib/format.js';
import { state, isManager } from '../state.js';
import { signOut } from '../auth.js';
import { openScanner, routeScan } from './scanner.js';
import { openGlobalSearch } from './globalSearch.js';
import * as overview from '../pages/overview.js';
import * as catalog from '../pages/catalog.js';
import * as calendar from '../pages/calendar.js';
import * as chat from '../pages/chat.js';
import * as me from '../pages/me.js';
import * as settings from '../pages/settings.js';
import * as terminal from '../pages/terminal.js';
import * as protocol from '../pages/protocol.js';
import * as inventory from '../pages/inventory.js';
import * as help from '../pages/help.js';
import { mountOfflineBanner } from './offline.js';
import { unreadSummary } from '../lib/unread.js';

// main: erscheint in der unteren Leiste (Handy); der Rest liegt unter "Mehr"
const ALL_ROUTES = {
  uebersicht: { label: 'Übersicht', short: 'Start', icon: 'home', page: overview, main: true },
  katalog: { label: 'Katalog', short: 'Katalog', icon: 'package', page: catalog, main: true },
  kalender: { label: 'Kalender', short: 'Kalender', icon: 'calendar', page: calendar, main: true },
  chat: { label: 'Chat & Mitteilungen', short: 'Chat', icon: 'chat', page: chat, main: true, badge: true },
  ich: { label: 'Mein Bereich', short: 'Ich', icon: 'user', page: me, main: true },
  terminal: { label: 'Lagerwart-Terminal', short: 'Lagerwart', icon: 'shield', page: terminal, managerOnly: true },
  inventur: { label: 'Inventur', short: 'Inventur', icon: 'clipboard', page: inventory, managerOnly: true },
  protokoll: { label: 'Protokoll', short: 'Protokoll', icon: 'file', page: protocol, managerOnly: true },
  hilfe: { label: 'Hilfe', short: 'Hilfe', icon: 'help', page: help },
  einstellungen: { label: 'Einstellungen', short: 'Einstellungen', icon: 'settings', page: settings },
};

let hashHandler = null;
let unmount = null;

export function renderShell(root) {
  const routes = Object.entries(ALL_ROUTES).filter(([, r]) => !r.managerOnly || isManager());
  const mainRoutes = routes.filter(([, r]) => r.main);
  const moreRoutes = routes.filter(([, r]) => !r.main);
  const badge = (cls) => `<span data-badge class="hidden rounded-full bg-red-500 px-1.5 text-[13px] font-bold text-white ${cls}"></span>`;

  root.innerHTML = `
  <a href="#page" class="skip-link" id="skip">Zum Inhalt springen</a>
  <div class="flex min-h-screen">
    <aside class="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-3 overflow-hidden bg-[#0f172a] p-4 text-[#cbd5e1] md:flex">
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="mb-6 flex items-center gap-3 px-2 text-white">${logoMark('h-8 w-auto shrink-0')}<span class="leading-tight"><span class="block font-bold">MBG Lemgo</span><span class="block text-[13px] font-medium text-[#94a3b8]">Lagerverwaltung</span></span></div>
        <button id="searchBtn" class="mb-2 flex w-full items-center gap-2 rounded-xl bg-[#1e293b] px-3 py-2 text-sm text-[#94a3b8] hover:text-white">${icon('search', 'h-4 w-4')}<span>Suchen</span><kbd class="ml-auto rounded bg-[#0f172a] px-1.5 text-[13px]">Strg K</kbd></button>
        <button id="scanBtn" class="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-brand-800">${icon('camera', 'h-4 w-4')} Scannen</button>
        <nav class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" id="sideNav" aria-label="Hauptmenü">
          ${routes.map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium hover:bg-[#1e293b]">${icon(r.icon, 'h-5 w-5 shrink-0')}<span class="truncate">${esc(r.label)}</span>${r.badge ? badge('ml-auto') : ''}</a>`).join('')}
        </nav>
      </div>
      <div class="shrink-0 rounded-xl bg-[#1e293b] p-3">
        <div class="truncate text-xs font-bold text-white">${esc(displayName(state.profile))}</div>
        <div class="mb-2 text-[13px] uppercase tracking-wider text-[#94a3b8]">${esc(roleName(state.profile.role))}${state.profile.managed_room ? ' · ' + esc(state.profile.managed_room) : ''}</div>
        <button id="logoutBtn" class="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0f172a] px-2 py-1.5 text-xs font-semibold text-[#cbd5e1] hover:text-white">${icon('logout', 'h-4 w-4')} Abmelden</button>
      </div>
    </aside>
    <main class="min-w-0 flex-1 pb-24 md:pb-8" aria-label="Inhalt"><div id="page" tabindex="-1" class="mx-auto max-w-5xl p-4 md:p-8"></div></main>
    <button id="searchFab" class="fixed bottom-32 right-3 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-slate-700/90 text-white shadow-lg md:hidden" title="Suchen">${icon('search', 'h-5 w-5')}</button>
    <button id="scanFab" class="fixed bottom-20 right-3 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-brand-700/95 text-white shadow-lg md:hidden" title="Scannen">${icon('camera', 'h-5 w-5')}</button>
    <nav class="fixed inset-x-0 bottom-0 z-40 grid border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" id="tabBar" aria-label="Menü" style="grid-template-columns:repeat(${mainRoutes.length + 1},minmax(0,1fr))">
      ${mainRoutes.map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="relative flex flex-col items-center py-2 text-[13px] font-semibold text-slate-500">${icon(r.icon, 'h-5 w-5')}${esc(r.short)}${r.badge ? badge('absolute right-2 top-1 !px-1 text-[13px]') : ''}</a>`).join('')}
      <button id="moreBtn" class="flex flex-col items-center py-2 text-[13px] font-semibold text-slate-500">${icon('settings', 'h-5 w-5')}Mehr</button>
    </nav>
  </div>`;
  root.querySelector('#logoutBtn').onclick = signOut;
  // „Zum Inhalt springen“ darf den Hash-Router nicht auslösen
  root.querySelector('#skip').onclick = (e) => { e.preventDefault(); root.querySelector('#page').focus(); };
  const scan = () => openScanner(routeScan);
  root.querySelector('#scanBtn').onclick = scan;
  root.querySelector('#scanFab').onclick = scan;
  root.querySelector('#searchBtn').onclick = openGlobalSearch;
  root.querySelector('#searchFab').onclick = openGlobalSearch;
  if (!window.__searchKey) {
    window.__searchKey = true;
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openGlobalSearch(); }
    });
  }
  root.querySelector('#moreBtn').onclick = () => {
    const { el } = openModal(`<h3 class="mb-3 text-lg font-bold">Mehr</h3><div class="space-y-1">
      ${moreRoutes.map(([k, r]) => `<a href="#/${k}" data-close class="flex items-center gap-3 rounded-xl p-3 font-semibold hover:bg-slate-100">${icon(r.icon, 'h-5 w-5')}${esc(r.label)}</a>`).join('')}
      <button id="mLogout" class="flex w-full items-center gap-3 rounded-xl p-3 text-left font-semibold text-red-600 hover:bg-slate-100">${icon('logout', 'h-5 w-5')}Abmelden</button></div>`);
    el.querySelector('#mLogout').onclick = signOut;
  };

  let navSeq = 0;
  const go = async () => {
    const seq = ++navSeq; // spätere Navigation gewinnt: Fehler einer verlassenen Seite nicht mehr anzeigen
    if (unmount) { try { unmount(); } catch { /* ignore */ } unmount = null; }
    const key = (location.hash.replace('#/', '') || 'uebersicht').split('?')[0];
    const entry = routes.find(([k]) => k === key) || routes[0];
    const [activeKey, route] = entry;
    root.querySelectorAll('[data-route]').forEach((a) => {
      const active = a.dataset.route === activeKey;
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      const side = !!a.closest('#sideNav');
      if (side) { a.classList.toggle('bg-[#1e293b]', active); a.classList.toggle('text-white', active); }
      else { a.classList.toggle('text-brand-700', active); a.classList.toggle('text-slate-500', !active); }
    });
    const container = root.querySelector('#page');
    container.innerHTML = '';
    try {
      await route.page.render(container);
      unmount = route.page.unmount || null;
    } catch (e) {
      if (seq === navSeq) container.innerHTML = `<div class="card text-red-600">Seite konnte nicht geladen werden: ${esc(e.message)}</div>`;
    }
    if (seq === navSeq) window.scrollTo(0, 0);
  };
  if (hashHandler) window.removeEventListener('hashchange', hashHandler);
  hashHandler = go;
  window.addEventListener('hashchange', go);
  go();
  watchNotifications(root);
  mountOfflineBanner();
}

// Badge ungelesener Mitteilungen (Realtime)
async function watchNotifications(root) {
  const refresh = async () => {
    const u = await unreadSummary();
    const count = u.total;
    root.querySelectorAll('[data-badge]').forEach((b) => {
      b.textContent = count > 99 ? '99+' : count || ''; b.classList.toggle('hidden', !count);
      b.title = `${u.messages} Chat-Nachricht(en), ${u.notifications} Mitteilung(en)`;
    });
  };
  refresh();
  window.addEventListener('notifications-changed', refresh);
  supabase.channel('notif-badge')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.user.id}` }, refresh)
    .subscribe();
}
