import { supabase, unwrap } from './lib/supabase.js';
import { esc, toast, busy } from './lib/ui.js';

export function renderAuth(root) {
  let register = false;
  const draw = () => {
    root.innerHTML = `
    <div class="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div class="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div class="bg-slate-900 p-8 text-center">
          <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/15 text-3xl">📦</div>
          <h1 class="text-2xl font-bold text-white">Lagerverwaltung Pro</h1>
          <p class="mt-1 text-xs text-slate-400">Sicheres Waren- und Teammanagement</p>
        </div>
        <form id="authForm" class="space-y-4 p-8">
          ${register ? `
          <div><label class="label">Vollständiger Name</label><input id="fullName" class="input" required autocomplete="name"></div>
          <div><label class="label">Benutzername</label><input id="username" class="input" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9._-]+" autocomplete="username" placeholder="max.mustermann"></div>
          <div><label class="label">E-Mail</label><input id="email" type="email" class="input" required autocomplete="email"></div>` : `
          <div><label class="label">Benutzername oder E-Mail</label><input id="identifier" class="input" required autocomplete="username"></div>`}
          <div><label class="label">Passwort</label><input id="password" type="password" class="input" required minlength="8" autocomplete="${register ? 'new-password' : 'current-password'}"></div>
          <button class="btn-primary w-full py-3" id="submitBtn">${register ? 'Konto erstellen' : 'Anmelden'} →</button>
          <button type="button" id="toggle" class="w-full text-center text-xs font-semibold text-brand-600">${register ? 'Bereits ein Konto? Anmelden' : 'Noch kein Konto? Registrieren'}</button>
        </form>
      </div>
    </div>`;
    root.querySelector('#toggle').onclick = () => { register = !register; draw(); };
    root.querySelector('#authForm').onsubmit = (e) => {
      e.preventDefault();
      busy(root.querySelector('#submitBtn'), () => (register ? doRegister(root) : doLogin(root)));
    };
  };
  draw();
}

async function doLogin(root) {
  const identifier = root.querySelector('#identifier').value.trim();
  const password = root.querySelector('#password').value;
  let email = identifier;
  if (!identifier.includes('@')) {
    email = unwrap(await supabase.rpc('email_for_username', { p_username: identifier }));
    if (!email) throw new Error('Benutzername oder Passwort falsch');
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error('Benutzername/E-Mail oder Passwort falsch');
  // onAuthStateChange in main.js übernimmt den Rest
}

async function doRegister(root) {
  const full_name = root.querySelector('#fullName').value.trim();
  const username = root.querySelector('#username').value.trim().toLowerCase();
  const email = root.querySelector('#email').value.trim().toLowerCase();
  const password = root.querySelector('#password').value;
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name, username } } });
  if (error) throw new Error(error.message);
  if (!data.session) toast('Konto erstellt. Bitte bestätige deine E-Mail-Adresse und melde dich danach an.', 'success');
}

export const signOut = async () => { await supabase.auth.signOut(); location.hash = ''; location.reload(); };
