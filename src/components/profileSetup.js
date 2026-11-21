import { supabase, unwrap } from '../lib/supabase.js';
import { maybeStartTour } from './tour.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';
import { state } from '../state.js';
import { suggestUsername, displayName } from '../lib/format.js';

// Einmalige Abfrage: Name und Benutzername bestätigen
export function openProfileSetup(prefs) {
  const p = state.profile;
  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">Willkommen! Profil bestätigen</h3>
    <p class="mb-3 text-sm text-slate-500">So erscheinst du bei anderen (Chat, Ausleihen). Du kannst das später in den Einstellungen ändern.</p>
    <form id="f" class="space-y-3">
      <div><label class="label">Name</label><input name="full_name" class="input" value="${esc(displayName(p) === p.username ? '' : p.full_name)}" required></div>
      <div><label class="label">Benutzername</label><input name="username" class="input" value="${esc(p.username)}" pattern="[a-z0-9._-]{3,30}" required>
        <button type="button" id="sug" class="mt-1 text-xs font-semibold text-brand-700">Vorschlag aus dem Namen übernehmen</button></div>
      <div class="flex justify-end gap-2 pt-2"><button type="button" id="keep" class="btn-ghost">So lassen</button><button class="btn-primary">Speichern</button></div>
    </form>`);
  const f = el.querySelector('#f');
  el.querySelector('#sug').onclick = () => { const s = suggestUsername(f.elements.full_name.value); if (s.length >= 3) f.elements.username.value = s; else toast('Bitte zuerst den Namen eintragen.', 'error'); };
  const markDone = async () => unwrap(await supabase.from('user_settings').upsert({ user_id: state.user.id, prefs: { ...prefs, profile_done: true } }));
  el.querySelector('#keep').onclick = () => busy(null, async () => { await markDone(); close(); maybeStartTour({ ...prefs, profile_done: true }); });
  f.onsubmit = (e) => {
    e.preventDefault();
    busy(e.target.querySelector('.btn-primary'), async () => {
      const upd = { full_name: f.elements.full_name.value.trim(), username: f.elements.username.value.trim().toLowerCase() };
      const { error } = await supabase.from('profiles').update(upd).eq('id', state.user.id);
      if (error) throw new Error(error.code === '23505' ? 'Dieser Benutzername ist bereits vergeben.' : error.message);
      Object.assign(state.profile, upd);
      await markDone(); close(); toast('Profil gespeichert', 'success');
      maybeStartTour({ ...prefs, profile_done: true });
      window.dispatchEvent(new Event('hashchange'));
    });
  };
}
