import './style.css';
import { supabase, unwrap } from './lib/supabase.js';
import { state } from './state.js';
import { renderAuth, showPasswordReset } from './auth.js';
import { renderShell } from './components/shell.js';
import { registerServiceWorker } from './lib/push.js';
import { applyTheme, getTheme, setTheme } from './lib/theme.js';

applyTheme();

const root = document.getElementById('app');
let booted = false;

async function boot(session) {
  if (!session) { booted = false; renderAuth(root); return; }
  if (booted && state.user?.id === session.user.id) return;
  booted = true;
  state.user = session.user;
  try {
    state.profile = unwrap(await supabase.from('profiles').select('*').eq('id', session.user.id).single());
    state.rooms = unwrap(await supabase.from('rooms').select('*').order('sort_order'));
    renderShell(root);
    supabase.from('user_settings').select('prefs').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => { const t = data?.prefs?.theme; if (t && t !== getTheme()) setTheme(t); });
  } catch (e) {
    booted = false;
    root.innerHTML = `<div class="p-8 text-center text-red-600">Profil konnte nicht geladen werden: ${String(e.message).replace(/</g, '&lt;')}<br><button class="mt-4 rounded-xl bg-slate-800 px-4 py-2 text-white" onclick="location.reload()">Neu laden</button></div>`;
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { setTimeout(() => showPasswordReset(), 0); }
  setTimeout(() => boot(session), 0);
});
supabase.auth.getSession().then(({ data }) => boot(data.session));
registerServiceWorker();
