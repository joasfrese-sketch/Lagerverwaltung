import { supabase, unwrap } from './lib/supabase.js';
import { esc, toast, busy, openModal } from './lib/ui.js';

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
          ${register ? '' : '<button type="button" id="forgot" class="w-full text-center text-xs text-slate-500 hover:underline">Passwort vergessen?</button>'}
          <button type="button" id="toggle" class="w-full text-center text-xs font-semibold text-brand-600">${register ? 'Bereits ein Konto? Anmelden' : 'Noch kein Konto? Registrieren'}</button>
        </form>
      </div>
    </div>`;
    root.querySelector('#toggle').onclick = () => { register = !register; draw(); };
    const forgot = root.querySelector('#forgot');
    if (forgot) forgot.onclick = () => forgotPassword(root);
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
  if (!identifier.includes('@')) {
    // Benutzername: serverseitig auflösen, damit E-Mail-Adressen nicht öffentlich abfragbar sind
    const { data, error } = await supabase.functions.invoke('username-auth', { body: { action: 'login', identifier, password } });
    if (error || !data) throw new Error('Anmeldung momentan nicht möglich. Bitte später erneut versuchen.');
    if (data.error === 'not_confirmed') throw new Error('Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungsmail).');
    if (data.error) throw new Error('Benutzername/E-Mail oder Passwort falsch');
    const { error: e2 } = await supabase.auth.setSession(data.session);
    if (e2) throw new Error(e2.message);
    return;
  }
  const { error } = await supabase.auth.signInWithPassword({ email: identifier.toLowerCase(), password });
  if (error) {
    if (/confirm/i.test(error.message)) throw new Error('Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungsmail).');
    throw new Error('Benutzername/E-Mail oder Passwort falsch');
  }
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

async function forgotPassword(root) {
  const id = root.querySelector('#identifier').value.trim();
  if (!id) return toast('Bitte zuerst Benutzername oder E-Mail eingeben.', 'error');
  await busy(null, async () => {
    if (id.includes('@')) await supabase.auth.resetPasswordForEmail(id.toLowerCase(), { redirectTo: location.origin });
    else await supabase.functions.invoke('username-auth', { body: { action: 'reset', identifier: id, redirectTo: location.origin } });
    // Immer dieselbe Antwort, damit keine Konten erraten werden können
    toast('Falls das Konto existiert, wurde eine E-Mail zum Zurücksetzen gesendet.', 'success');
  });
}

export function showPasswordReset() {
  const { el, close } = openModal(`
    <h3 class="mb-3 text-lg font-bold">Neues Passwort festlegen</h3>
    <form id="f" class="space-y-3"><input id="np" type="password" minlength="8" required class="input" placeholder="Mindestens 8 Zeichen" autocomplete="new-password">
    <button class="btn-primary w-full">Passwort speichern</button></form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    busy(e.target.querySelector('button'), async () => {
      const { error } = await supabase.auth.updateUser({ password: el.querySelector('#np').value });
      if (error) throw new Error(error.message);
      close(); toast('Passwort geändert', 'success');
    });
  };
}
