import { supabase } from '../lib/supabase.js';
import { esc } from '../lib/ui.js';
import { state } from '../state.js';
import { signOut } from '../auth.js';
import * as overview from '../pages/overview.js';
import * as catalog from '../pages/catalog.js';
import * as me from '../pages/me.js';
import * as calendar from '../pages/calendar.js';
import * as soon from '../pages/soon.js';

const ROUTES = {
  uebersicht: { label: 'Übersicht', icon: '🏠', page: overview },
  katalog: { label: 'Katalog', icon: '📦', page: catalog },
  kalender: { label: 'Kalender', icon: '📅', page: calendar },
  chat: { label: 'Chat', icon: '💬', page: soon, props: { title: 'Chat & Benachrichtigungen', text: 'Gesamtchat, Gruppen, Direktnachrichten und Benachrichtigungszentrale.' } },
  ich: { label: 'Ich', icon: '👤', page: me },
  einstellungen: { label: 'Einstellungen', icon: '⚙️', page: soon, props: { title: 'Einstellungen', text: 'Benachrichtigungen, Berechtigungen, App-Einstellungen.' } },
};

let hashHandler = null;

export function renderShell(root) {
  const nav = Object.entries(ROUTES);
  root.innerHTML = `
  <div class="flex min-h-screen">
    <aside class="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between bg-slate-900 p-4 text-slate-300 md:flex">
      <div>
        <div class="mb-6 flex items-center gap-3 px-2"><span class="text-2xl">📦</span><span class="font-bold text-white">Lager Pro</span></div>
        <nav class="space-y-1" id="sideNav">
          ${nav.map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium hover:bg-slate-800"><span>${r.icon}</span>${r.label}<span data-badge="${k}" class="ml-auto hidden rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white"></span></a>`).join('')}
        </nav>
      </div>
      <div class="flex items-center justify-between rounded-xl bg-slate-800/60 p-3">
        <div class="min-w-0"><div class="truncate text-xs font-bold text-white">${esc(state.profile.full_name || state.profile.username)}</div><div class="text-[10px] uppercase tracking-wider text-slate-400">${esc(roleLabel())}</div></div>
        <button id="logoutBtn" title="Abmelden" class="text-slate-400 hover:text-white">⎋</button>
      </div>
    </aside>
    <main class="min-w-0 flex-1 pb-24 md:pb-8"><div id="page" class="mx-auto max-w-5xl p-4 md:p-8"></div></main>
    <nav class="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" id="tabBar">
      ${nav.map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="flex flex-col items-center py-2 text-[10px] font-semibold text-slate-500"><span class="text-lg">${r.icon}</span>${r.label === 'Einstellungen' ? 'Mehr' : r.label}</a>`).join('')}
    </nav>
  </div>`;
  root.querySelector('#logoutBtn').onclick = signOut;

  const go = () => {
    const key = (location.hash.replace('#/', '') || 'uebersicht').split('?')[0];
    const route = ROUTES[key] || ROUTES.uebersicht;
    root.querySelectorAll('[data-route]').forEach((a) => {
      const active = a.dataset.route === key;
      const side = !!a.closest('#sideNav');
      a.classList.toggle('bg-slate-800', active && side);
      a.classList.toggle('text-white', active && side);
      a.classList.toggle('text-brand-600', active && !side);
    });
    const container = root.querySelector('#page');
    container.innerHTML = '';
    route.page.render(container, route.props || {});
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

// Badge für ungelesene Benachrichtigungen (Realtime) – hängt am Chat-Eintrag, bis die Benachrichtigungszentrale existiert
async function watchNotifications(root) {
  const refresh = async () => {
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    root.querySelectorAll('[data-badge="chat"]').forEach((b) => { b.textContent = count || ''; b.classList.toggle('hidden', !count); });
  };
  refresh();
  supabase.channel('notif-badge')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.user.id}` }, refresh)
    .subscribe();
}
