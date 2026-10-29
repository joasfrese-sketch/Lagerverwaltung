import './style.css';
import { supabase, unwrap } from './lib/supabase.js';
import { state } from './state.js';
import { renderAuth } from './auth.js';
import { renderShell } from './components/shell.js';

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
  } catch (e) {
    root.innerHTML = `<div class="p-8 text-center text-red-600">Profil konnte nicht geladen werden: ${e.message}</div>`;
  }
}

supabase.auth.onAuthStateChange((_event, session) => { setTimeout(() => boot(session), 0); });
supabase.auth.getSession().then(({ data }) => boot(data.session));
