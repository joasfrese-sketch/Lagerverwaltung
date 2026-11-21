import './style.css';
import { supabase, unwrap } from './lib/supabase.js';
import { state } from './state.js';
import { renderAuth, showPasswordReset, mfaRequired, showMfaPrompt } from './auth.js';
import { openProfileSetup } from './components/profileSetup.js';
import { renderShell } from './components/shell.js';
import { registerServiceWorker } from './lib/push.js';
import { applyTheme, getTheme, setTheme } from './lib/theme.js';
import { captureInstallPrompt } from './components/installHint.js';
import { watchA11y } from './lib/a11y.js';
import { installErrorReporting } from './lib/errorReport.js';
import { maybeStartTour } from './components/tour.js';

applyTheme();
captureInstallPrompt();
watchA11y();
installErrorReporting();

const root = document.getElementById('app');
let booted = false;
let mfaShowing = false;

async function boot(session) {
  if (!session) { booted = false; renderAuth(root); return; }
  if (booted && state.user?.id === session.user.id) return;
  if (mfaShowing) return;
  if (await mfaRequired()) {
    mfaShowing = true;
    showMfaPrompt(root, async () => { mfaShowing = false; const { data } = await supabase.auth.getSession(); booted = false; boot(data.session); });
    return;
  }
  booted = true;
  state.user = session.user;
  try {
    state.profile = unwrap(await supabase.from('profiles').select('*').eq('id', session.user.id).single());
    state.rooms = unwrap(await supabase.from('rooms').select('*').order('sort_order'));
    renderShell(root);
    supabase.from('user_settings').select('prefs').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => {
        const prefs = data?.prefs || {};
        if (prefs.theme && prefs.theme !== getTheme()) setTheme(prefs.theme);
        if (!prefs.profile_done) openProfileSetup(prefs);
        else maybeStartTour(prefs);
      });
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
