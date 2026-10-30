import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, busy, openModal } from '../lib/ui.js';
import { state, isAdmin, isManager } from '../state.js';
import { getTheme, setTheme } from '../lib/theme.js';
import { enablePush, disablePush, pushActive, pushSupported, pushConfigured } from '../lib/push.js';

export async function render(el) {
  const settings = unwrap(await supabase.from('user_settings').select('prefs').eq('user_id', state.user.id).maybeSingle());
  const prefs = { notify_deadline: true, notify_rental: true, notify_chat: true, push: true, calendar_view: 'month', ...(settings?.prefs || {}) };
  const pushOn = await pushActive();
  const p = state.profile;
  const toggle = (k, label, hint = '') => `<label class="flex items-start justify-between gap-3 py-2"><span><b class="text-sm">${label}</b>${hint ? `<span class="block text-xs text-slate-500">${hint}</span>` : ''}</span><input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''} class="mt-1 h-5 w-5 rounded text-brand-600"></label>`;

  el.innerHTML = `<h1 class="mb-4 text-2xl font-bold">Einstellungen</h1><div class="space-y-4">
    <section class="card"><h2 class="mb-3 font-bold">👤 Profil</h2>
      <form id="prof" class="grid gap-3 md:grid-cols-2"><div><label class="label">Name</label><input name="full_name" class="input" value="${esc(p.full_name)}" required></div>
      <div><label class="label">Benutzername</label><input name="username" class="input" value="${esc(p.username)}" pattern="[a-z0-9._-]{3,30}" title="3–30 Zeichen: a–z, 0–9, . _ -" required></div>
      <div class="md:col-span-2 text-xs text-slate-500">E-Mail: ${esc(p.email)}</div><div class="md:col-span-2"><button class="btn-primary">Speichern</button></div></form></section>

    <section class="card"><h2 class="mb-1 font-bold">🔔 Benachrichtigungen</h2><div class="divide-y">
      ${toggle('notify_rental', 'Ausleihen & Rückgaben', 'Bestätigungen in der App')}
      ${toggle('notify_chat', 'Chat-Nachrichten', 'Direkt- und Gruppenchats')}
      ${toggle('notify_deadline', 'Fristen & Überfälligkeit', 'Erinnerung 24 h vorher und bei Überfälligkeit')}</div>
      <div class="mt-2 flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><span class="text-sm"><b>📲 Push-Nachrichten</b><span class="block text-xs text-slate-500">${!pushSupported() ? 'Dieser Browser unterstützt kein Push (iPhone: erst zum Home-Bildschirm hinzufügen).' : !pushConfigured() ? 'Noch nicht eingerichtet (VAPID-Schlüssel fehlt).' : 'Für deine eigenen Aktivitäten (Fristen, Ausleihen durch andere für dich, Chat). Gilt für dieses Gerät.'}</span></span>
      <button id="pushBtn" class="${pushOn ? 'btn-ghost' : 'btn-primary'}" ${!pushSupported() || !pushConfigured() ? 'disabled' : ''}>${pushOn ? 'Deaktivieren' : 'Aktivieren'}</button></div></section>

    <section class="card"><h2 class="mb-2 font-bold">🌓 Darstellung</h2>
      <div id="themeSeg" class="inline-flex rounded-xl bg-slate-100 p-0.5 text-sm font-semibold">
        <button data-theme="light" class="rounded-lg px-3 py-1.5">☀️ Hell</button>
        <button data-theme="dark" class="rounded-lg px-3 py-1.5">🌙 Dunkel</button>
        <button data-theme="auto" class="rounded-lg px-3 py-1.5">🖥️ Automatisch</button></div>
      <p class="mt-1 text-xs text-slate-500">„Automatisch" folgt der Einstellung deines Geräts.</p></section>

    <section class="card"><h2 class="mb-2 font-bold">🎛️ App</h2><label class="label">Kalenderansicht</label>
      <select id="view" class="input !w-auto"><option value="month" selected>Monat</option><option value="week" disabled>Woche (folgt)</option><option value="list" disabled>Liste (folgt)</option></select></section>

    <section class="card"><h2 class="mb-2 font-bold">🔒 Sicherheit</h2>
      <form id="pw" class="flex flex-wrap gap-2"><input name="pw" type="password" minlength="8" required class="input !w-auto flex-1" placeholder="Neues Passwort (min. 8 Zeichen)" autocomplete="new-password"><button class="btn-primary">Ändern</button></form></section>

    ${isManager() ? '<section class="card"><div class="mb-3 flex items-center justify-between"><h2 class="font-bold">🛡️ Benutzer & Berechtigungen</h2>' + (isAdmin() ? '<button id="newUser" class="btn-primary !py-1.5">+ Benutzer</button>' : '') + '</div><div id="users" class="space-y-2"><p class="text-sm text-slate-400">Lade…</p></div></section>' : ''}
  </div>`;

  // Profil
  el.querySelector('#prof').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target);
    busy(e.target.querySelector('button'), async () => {
      const upd = { full_name: f.get('full_name').trim(), username: f.get('username').trim().toLowerCase() };
      const { error } = await supabase.from('profiles').update(upd).eq('id', state.user.id);
      if (error) throw new Error(error.code === '23505' ? 'Dieser Benutzername ist bereits vergeben.' : error.message);
      Object.assign(state.profile, upd); toast('Profil gespeichert', 'success');
    }); };
  // Einstellungen speichern
  const savePrefs = async () => unwrap(await supabase.from('user_settings').upsert({ user_id: state.user.id, prefs }));
  el.querySelectorAll('[data-pref]').forEach((c) => (c.onchange = () => busy(null, async () => { prefs[c.dataset.pref] = c.checked; await savePrefs(); toast('Gespeichert', 'success'); })));
  const markTheme = () => el.querySelectorAll('[data-theme]').forEach((b) => { const on = b.dataset.theme === getTheme(); b.className = `rounded-lg px-3 py-1.5 ${on ? 'bg-brand-600 text-white' : 'text-slate-600'}`; });
  markTheme();
  el.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => busy(null, async () => { setTheme(b.dataset.theme); prefs.theme = b.dataset.theme; markTheme(); await savePrefs(); })));
  el.querySelector('#view').onchange = (e) => busy(null, async () => { prefs.calendar_view = e.target.value; localStorage.setItem('cal_view', e.target.value); await savePrefs(); });
  el.querySelector('#pushBtn').onclick = (e) => busy(e.target, async () => {
    if (pushOn) await disablePush(); else await enablePush();
    toast(pushOn ? 'Push deaktiviert' : 'Push aktiviert', 'success'); render(el);
  });
  el.querySelector('#pw').onsubmit = (e) => { e.preventDefault();
    busy(e.target.querySelector('button'), async () => {
      const { error } = await supabase.auth.updateUser({ password: new FormData(e.target).get('pw') });
      if (error) throw new Error(error.message); e.target.reset(); toast('Passwort geändert', 'success');
    }); };
  if (isManager()) loadUsers(el);
  el.querySelector('#newUser')?.addEventListener('click', () => newUserModal(() => loadUsers(el)));
}

async function loadUsers(el) {
  const box = el.querySelector('#users');
  try {
    const users = unwrap(await supabase.from('profiles').select('*').order('full_name'));
    const perms = unwrap(await supabase.from('permissions').select('*'));
    const known = [...new Set([...perms.map((x) => x.permission_name), ...unwrap(await supabase.from('items').select('required_permission').not('required_permission', 'is', null)).map((i) => i.required_permission)])];
    box.innerHTML = `<datalist id="pl">${known.map((k) => `<option value="${esc(k)}">`).join('')}</datalist>` + users.map((u) => {
      const mine = perms.filter((x) => x.user_id === u.id);
      return `<div class="rounded-xl border p-3" data-u="${esc(u.id)}"><div class="flex flex-wrap items-center gap-2"><div class="mr-auto min-w-0"><b class="text-sm">${esc(u.full_name || u.username)}</b><div class="truncate text-xs text-slate-500">@${esc(u.username)} · ${esc(u.email)}</div></div>
        ${isAdmin() && u.id !== state.user.id ? `<select data-role class="input !w-auto !py-1.5 text-xs"><option value="user" ${u.role === 'user' ? 'selected' : ''}>Benutzer</option><option value="raum_manager" ${u.role === 'raum_manager' ? 'selected' : ''}>Raum-Manager</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option></select>
        <select data-room class="input !w-auto !py-1.5 text-xs ${u.role === 'raum_manager' ? '' : 'hidden'}"><option value="">Alle Räume</option>${state.rooms.map((r) => `<option value="${esc(r.id)}" ${u.managed_room === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>` : `<span class="badge bg-slate-100 text-slate-600">${esc(u.role)}</span>`}</div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">${mine.map((x) => `<span class="badge bg-brand-100 text-brand-700">${esc(x.permission_name)} <button data-delperm="${esc(x.permission_name)}" class="ml-1">✕</button></span>`).join('')}
        <form data-addperm class="flex gap-1"><input list="pl" name="p" class="input !w-36 !py-1 text-xs" placeholder="+ Berechtigung" required><button class="btn-ghost !px-2 !py-1 !text-xs">+</button></form></div></div>`;
    }).join('');
    box.querySelectorAll('[data-u]').forEach((row) => {
      const id = row.dataset.u;
      const upd = (patch) => busy(null, async () => { unwrap(await supabase.from('profiles').update(patch).eq('id', id)); toast('Gespeichert', 'success'); loadUsers(el); });
      row.querySelector('[data-role]')?.addEventListener('change', (e) => upd({ role: e.target.value, managed_room: e.target.value === 'raum_manager' ? row.querySelector('[data-room]').value || null : null }));
      row.querySelector('[data-room]')?.addEventListener('change', (e) => upd({ managed_room: e.target.value || null }));
      row.querySelectorAll('[data-delperm]').forEach((b) => (b.onclick = () => busy(null, async () => { unwrap(await supabase.from('permissions').delete().eq('user_id', id).eq('permission_name', b.dataset.delperm)); loadUsers(el); })));
      row.querySelector('[data-addperm]').onsubmit = (e) => { e.preventDefault(); const name = new FormData(e.target).get('p').trim();
        busy(null, async () => { unwrap(await supabase.from('permissions').upsert({ user_id: id, permission_name: name }, { onConflict: 'user_id,permission_name', ignoreDuplicates: true })); loadUsers(el); }); };
    });
  } catch (e) { box.innerHTML = `<p class="text-red-600">${esc(e.message)}</p>`; }
}

function newUserModal(done) {
  const { el, close } = openModal(`<h3 class="mb-3 text-lg font-bold">Neuen Benutzer anlegen</h3>
    <form id="f" class="space-y-3"><input name="full_name" class="input" placeholder="Vollständiger Name" required>
    <input name="username" class="input" placeholder="Benutzername" pattern="[a-z0-9._-]{3,30}" required><input name="email" type="email" class="input" placeholder="E-Mail" required>
    <input name="password" type="password" minlength="8" class="input" placeholder="Start-Passwort (min. 8 Zeichen)" required>
    <select name="role" class="input"><option value="user">Benutzer</option><option value="raum_manager">Raum-Manager</option><option value="admin">Administrator</option></select>
    <select name="managed_room" class="input"><option value="">Alle Räume (nur Raum-Manager)</option>${state.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
    <div class="flex justify-end gap-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Anlegen</button></div></form>`);
  el.querySelector('#f').onsubmit = (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); body.username = body.username.toLowerCase(); body.email = body.email.toLowerCase(); body.managed_room = body.managed_room || null;
    busy(e.target.querySelector('.btn-primary'), async () => {
      const { data, error } = await supabase.functions.invoke('admin-create-user', { body });
      if (error || data?.error) throw new Error(data?.error || error.message);
      close(); toast('Benutzer angelegt', 'success'); done();
    }); };
}
