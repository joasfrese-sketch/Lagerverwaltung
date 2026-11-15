import { displayName } from '../lib/format.js';
import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, busy, openModal } from '../lib/ui.js';
import { state, isAdmin, isManager } from '../state.js';
import { getTheme, setTheme } from '../lib/theme.js';
import { roleName } from '../lib/format.js';
import { fetchAll, exportWorkbook } from '../lib/export.js';
import { getView, openSubscribe } from './calendar.js';
import { openExport } from '../components/exportDialog.js';
import { fmtDateTime } from '../lib/ui.js';
import { enablePush, disablePush, pushActive, pushSupported, pushConfigured } from '../lib/push.js';
import { collapsible, bindCollapsibles, setCount } from '../components/collapse.js';

export async function render(el) {
  const settings = unwrap(await supabase.from('user_settings').select('prefs').eq('user_id', state.user.id).maybeSingle());
  const prefs = { notify_deadline: true, notify_rental: true, notify_chat: true, push: true, calendar_view: 'month', ...(settings?.prefs || {}) };
  const pushOn = await pushActive();
  const p = state.profile;
  const toggle = (k, label, hint = '') => `<label class="flex items-start justify-between gap-3 py-2"><span><b class="text-sm">${label}</b>${hint ? `<span class="block text-xs text-slate-500">${hint}</span>` : ''}</span><input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''} class="mt-1 h-5 w-5 rounded text-brand-600"></label>`;

  const THEME = { light: 'Hell', dark: 'Dunkel', auto: 'Automatisch' };
  const HINTS = { prof: esc(p.full_name), notif: pushOn ? 'Push-Nachrichten aktiv' : 'Push-Nachrichten aus', look: THEME[getTheme()] || 'Automatisch', app: 'Kalenderansicht, Kalender-Abo', sec: 'Passwort, Zwei-Faktor-Anmeldung', data: 'Sicherung als Excel oder CSV' };
  const sec = (id, title, hint, body, count = null) => collapsible({ id: 'set-' + id, title, hint, body, count });
  el.innerHTML = `<h1 class="mb-3 text-2xl font-bold">Einstellungen</h1><div class="space-y-3">
    ${sec('prof', '👤 Profil', HINTS.prof, `
      <form id="prof" class="grid gap-3 md:grid-cols-2"><div><label class="label">Name</label><input name="full_name" class="input" value="${esc(p.full_name)}" required></div>
      <div><label class="label">Benutzername</label><input name="username" class="input" value="${esc(p.username)}" pattern="[a-z0-9._-]{3,30}" title="3–30 Zeichen: a–z, 0–9, . _ -" required></div>
      <div class="md:col-span-2 text-xs text-slate-500">E-Mail: ${esc(p.email)}</div><div class="md:col-span-2"><button class="btn-primary">Speichern</button></div></form>`)}

    ${sec('notif', '🔔 Benachrichtigungen', HINTS.notif, `<div class="divide-y">
      ${toggle('notify_rental', 'Ausleihen & Rückgaben', 'Bestätigungen in der App')}
      ${toggle('notify_chat', 'Chat-Nachrichten', 'Direkt- und Gruppenchats')}
      ${toggle('notify_deadline', 'Fristen & Überfälligkeit', 'Erinnerung 24 h vorher und bei Überfälligkeit')}</div>
      <div class="mt-2 flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3"><span class="text-sm"><b>📲 Push-Nachrichten</b><span class="block text-xs text-slate-500">${!pushSupported() ? 'Dieser Browser unterstützt kein Push (iPhone: erst zum Home-Bildschirm hinzufügen).' : !pushConfigured() ? 'Noch nicht eingerichtet (VAPID-Schlüssel fehlt).' : 'Für deine eigenen Aktivitäten (Fristen, Ausleihen durch andere für dich, Chat). Gilt für dieses Gerät.'}</span></span>
      <button id="pushBtn" class="${pushOn ? 'btn-ghost' : 'btn-primary'}" ${!pushSupported() || !pushConfigured() ? 'disabled' : ''}>${pushOn ? 'Deaktivieren' : 'Aktivieren'}</button></div>`)}

    ${sec('look', '🌓 Darstellung', HINTS.look, `
      <div id="themeSeg" class="inline-flex rounded-xl bg-slate-100 p-0.5 text-sm font-semibold">
        <button data-theme="light" class="rounded-lg px-3 py-1.5">☀️ Hell</button>
        <button data-theme="dark" class="rounded-lg px-3 py-1.5">🌙 Dunkel</button>
        <button data-theme="auto" class="rounded-lg px-3 py-1.5">🖥️ Automatisch</button></div>
      <p class="mt-1 text-xs text-slate-500">„Automatisch" folgt der Einstellung deines Geräts.</p>`)}

    ${sec('app', '🎛️ App', HINTS.app, `<label class="label">Kalenderansicht</label>
      <select id="view" class="input !w-auto">${[['month', 'Monat'], ['week', 'Woche'], ['list', 'Liste']].map(([v, l]) => `<option value="${v}" ${getView() === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="mt-3"><button id="calSub" class="btn-ghost">🔗 Kalender abonnieren (Google/Outlook)</button></div>`)}

    ${sec('sec', '🔒 Sicherheit', HINTS.sec, `
      <div id="mfaBox" class="mb-4 rounded-xl bg-slate-50 p-3 text-sm"></div>
      <form id="pw" class="flex flex-wrap gap-2"><input name="pw" type="password" minlength="8" required class="input !w-auto flex-1" placeholder="Neues Passwort (min. 8 Zeichen)" autocomplete="new-password"><button class="btn-primary">Ändern</button></form>`)}

    ${isManager() ? `${sec('data', '⬇️ Daten & Export', HINTS.data, `<p class="mb-3 text-xs text-slate-500">Sicherung als Excel oder CSV.</p><div class="flex flex-wrap gap-2"><button id="exItems" class="btn-ghost">Artikel</button><button id="exRentals" class="btn-ghost">Ausleihen (inkl. Historie)</button>${isAdmin() ? '<button id="backup" class="btn-primary">🗄️ Vollständige Sicherung (Excel)</button>' : ''}</div>${isAdmin() ? '<p class="mt-2 text-xs text-slate-500">Die Vollsicherung enthält Räume, Artikel, Ausleihen, Protokoll, Benutzer, Berechtigungen, Inventuren und Verlängerungsanträge in einer Datei mit mehreren Blättern. Empfehlung: einmal im Monat herunterladen und sicher ablegen.</p>' : ''}`)}` : ''}
    ${isAdmin() ? sec('invites', '🎟️ Einladungs-Codes', 'Registrierung nur mit Code', '<div class="mb-3 flex items-center justify-between gap-2"><p class="text-xs text-slate-500">Nur wer einen gültigen Code hat, kann sich registrieren.</p><button id="newInvite" class="btn-primary shrink-0 !py-1.5">+ Code</button></div><div id="invites" class="space-y-2"></div>', '…') : ''}
    ${isManager() ? sec('users', '🛡️ Benutzer & Berechtigungen', 'Rollen und Rechte verwalten', (isAdmin() ? '<div class="mb-3 flex justify-end"><button id="newUser" class="btn-primary !py-1.5">+ Benutzer</button></div>' : '') + '<div id="users" class="space-y-2"><p class="text-sm text-slate-400">Lade…</p></div>', '…') : ''}
  </div>`;

  bindCollapsibles(el);
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
  el.querySelector('#view').onchange = (e) => busy(null, async () => { prefs.calendar_view = e.target.value; localStorage.setItem('cal_view', e.target.value); await savePrefs(); toast('Gespeichert', 'success'); });
  el.querySelector('#calSub').onclick = openSubscribe;
  el.querySelector('#backup')?.addEventListener('click', (e) => busy(e.target, fullBackup));
  el.querySelector('#pushBtn').onclick = (e) => busy(e.target, async () => {
    if (pushOn) await disablePush(); else await enablePush();
    toast(pushOn ? 'Push deaktiviert' : 'Push aktiviert', 'success'); render(el);
  });
  el.querySelector('#pw').onsubmit = (e) => { e.preventDefault();
    busy(e.target.querySelector('button'), async () => {
      const { error } = await supabase.auth.updateUser({ password: new FormData(e.target).get('pw') });
      if (error) throw new Error(error.message); e.target.reset(); toast('Passwort geändert', 'success');
    }); };
  mfaSection(el);
  if (isAdmin()) { loadInvites(el); el.querySelector('#newInvite').onclick = () => inviteModal(() => loadInvites(el)); }
  if (isManager()) {
    el.querySelector('#exItems').onclick = () => openExport({ title: 'Artikel exportieren', filename: 'artikel', load: async () => {
      const rows = await fetchAll(() => supabase.from('items').select('*').order('id'));
      return { columns: [['id', 'ID'], ['name', 'Bezeichnung'], ['room_id', 'Raum'], ['category', 'Kategorie'], ['item_type', 'Typ'], ['status', 'Status'], ['stock_quantity', 'Bestand'], ['min_stock', 'Mindestbestand'], ['shelf', 'Regal'], ['compartment', 'Fach'], ['acc', 'Zubehör'], ['required_permission', 'Berechtigung'], ['fotos', 'Fotos']].map(([key, label]) => ({ key, label })),
        rows: rows.map((i) => ({ ...i, acc: (i.accessories || []).join(', '), fotos: (i.photos || []).length })) };
    } });
    el.querySelector('#exRentals').onclick = () => openExport({ title: 'Ausleihen exportieren', filename: 'ausleihen', load: async () => {
      const people = unwrap(await supabase.from('public_profiles').select('id, full_name, username'));
      const name = Object.fromEntries(people.map((x) => [x.id, displayName(x)]));
      const rows = await fetchAll(() => supabase.from('rentals').select('*, items(name)').order('start_at', { ascending: false }));
      return { columns: [['item_id', 'Artikel-ID'], ['artikel', 'Artikel'], ['borrower', 'Ausleiher'], ['start', 'Beginn'], ['end', 'Rückgabe fällig'], ['status', 'Status'], ['returned', 'Zurückgegeben am'], ['project', 'Projekt'], ['note', 'Notiz'], ['damage', 'Schaden']].map(([key, label]) => ({ key, label })),
        rows: rows.map((r) => ({ item_id: r.item_id, artikel: r.items?.name, borrower: name[r.borrower_id] || '', start: fmtDateTime(r.start_at), end: fmtDateTime(r.end_at), status: r.status, returned: r.returned_at ? fmtDateTime(r.returned_at) : '', project: r.project, note: r.return_note, damage: r.damage_report })) };
    } });
    loadUsers(el);
  }
  el.querySelector('#newUser')?.addEventListener('click', () => newUserModal(() => loadUsers(el)));
}

async function loadUsers(el) {
  const box = el.querySelector('#users');
  try {
    const users = unwrap(await supabase.from('profiles').select('*').order('full_name'));
    setCount(el, 'set-users', users.length);
    const perms = unwrap(await supabase.from('permissions').select('*'));
    const known = [...new Set([...perms.map((x) => x.permission_name), ...unwrap(await supabase.from('items').select('required_permission').not('required_permission', 'is', null)).map((i) => i.required_permission)])];
    box.innerHTML = `<datalist id="pl">${known.map((k) => `<option value="${esc(k)}">`).join('')}</datalist>` + users.map((u) => {
      const mine = perms.filter((x) => x.user_id === u.id);
      return `<div class="rounded-xl border p-3" data-u="${esc(u.id)}"><div class="flex flex-wrap items-center gap-2"><div class="mr-auto min-w-0"><b class="text-sm">${esc(displayName(u))}</b><div class="truncate text-xs text-slate-500">@${esc(u.username)} · ${esc(u.email)}</div></div>
        ${isAdmin() && u.id !== state.user.id ? `<select data-role class="input !w-auto !py-1.5 text-xs"><option value="user" ${u.role === 'user' ? 'selected' : ''}>Benutzer</option><option value="raum_manager" ${u.role === 'raum_manager' ? 'selected' : ''}>Raum-Manager</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option></select>
        <select data-room class="input !w-auto !py-1.5 text-xs ${u.role === 'raum_manager' ? '' : 'hidden'}"><option value="">Alle Räume</option>${state.rooms.map((r) => `<option value="${esc(r.id)}" ${u.managed_room === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>` : `<span class="badge bg-slate-100 text-slate-600">${esc(roleName(u.role))}</span>`}</div>
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
      if (error || data?.error) {
        let msg = data?.error;
        if (!msg && error?.context?.json) { try { msg = (await error.context.json())?.error; } catch { /* keine Details */ } }
        throw new Error(msg || error.message);
      }
      close(); toast('Benutzer angelegt', 'success'); done();
    }); };
}

// ----- Zwei-Faktor-Anmeldung (Authenticator-App) -----
async function mfaSection(el) {
  const box = el.querySelector('#mfaBox');
  const draw = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { box.textContent = 'Zwei-Faktor-Status konnte nicht geladen werden.'; return; }
    const verified = (data.totp || []).filter((f) => f.status === 'verified');
    box.innerHTML = verified.length
      ? `<div class="flex items-center justify-between gap-2"><span>✅ <b>Zwei-Faktor-Anmeldung ist aktiv.</b></span><button id="mfaOff" class="btn-ghost !py-1 !text-xs">Deaktivieren</button></div>`
      : `<div class="flex items-center justify-between gap-2"><span><b>Zwei-Faktor-Anmeldung</b> (Authenticator-App)${isAdmin() ? '<br><span class="text-xs text-amber-700">Für Administratoren dringend empfohlen.</span>' : ''}</span><button id="mfaOn" class="btn-primary !py-1 !text-xs">Aktivieren</button></div>`;
    box.querySelector('#mfaOff')?.addEventListener('click', (e) => busy(e.target, async () => {
      for (const f of verified) { const { error: ue } = await supabase.auth.mfa.unenroll({ factorId: f.id }); if (ue) throw new Error(ue.message); }
      toast('2FA deaktiviert', 'success'); draw();
    }));
    box.querySelector('#mfaOn')?.addEventListener('click', (e) => busy(e.target, async () => {
      for (const f of (data.totp || []).filter((x) => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: en, error: ee } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Lager Pro ${new Date().toISOString().slice(0, 16)}` });
      if (ee) throw new Error(ee.message);
      const { el: m, close } = openModal(`<h3 class="mb-2 text-lg font-bold">2FA einrichten</h3>
        <ol class="mb-3 list-decimal space-y-1 pl-5 text-sm"><li>Authenticator-App öffnen (z. B. Google/Microsoft Authenticator).</li><li>QR-Code scannen oder den Schlüssel eingeben.</li><li>6-stelligen Code unten eintragen.</li></ol>
        <img src="${esc(en.totp.qr_code)}" alt="QR-Code" class="mx-auto h-44 w-44 rounded-xl bg-white p-2">
        <p class="mt-2 break-all text-center font-mono text-xs text-slate-500">${esc(en.totp.secret)}</p>
        <form id="f" class="mt-3 space-y-3"><input name="code" class="input text-center font-mono text-xl tracking-[0.3em]" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required placeholder="123456">
        <div class="flex justify-end gap-2"><button type="button" id="cancel" class="btn-ghost">Abbrechen</button><button class="btn-primary">Bestätigen</button></div></form>`);
      m.querySelector('#cancel').onclick = async () => { await supabase.auth.mfa.unenroll({ factorId: en.id }); close(); };
      m.querySelector('#f').onsubmit = (ev) => { ev.preventDefault();
        busy(ev.target.querySelector('.btn-primary'), async () => {
          const { data: ch, error: ce } = await supabase.auth.mfa.challenge({ factorId: en.id });
          if (ce) throw new Error(ce.message);
          const { error: ve } = await supabase.auth.mfa.verify({ factorId: en.id, challengeId: ch.id, code: new FormData(ev.target).get('code').trim() });
          if (ve) throw new Error('Code falsch – bitte erneut versuchen.');
          close(); toast('2FA aktiviert', 'success'); draw();
        }); };
    }));
  };
  draw();
}

// ----- Einladungs-Codes (nur Admin) -----
async function loadInvites(el) {
  const box = el.querySelector('#invites');
  try {
    const rows = unwrap(await supabase.from('invite_codes').select('*').order('created_at', { ascending: false }));
    setCount(el, 'set-invites', rows.filter((c) => c.active && !(c.expires_at && new Date(c.expires_at) < new Date()) && !(c.max_uses && c.uses >= c.max_uses)).length + ' aktiv');
    box.innerHTML = rows.length ? rows.map((c) => {
      const expired = c.expires_at && new Date(c.expires_at) < new Date(); const full = c.max_uses && c.uses >= c.max_uses;
      const live = c.active && !expired && !full;
      return `<div class="flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-sm ${live ? '' : 'opacity-60'}"><span class="font-mono text-base font-bold tracking-widest">${esc(c.code)}</span>
        <span class="badge ${live ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">${live ? 'aktiv' : expired ? 'abgelaufen' : full ? 'aufgebraucht' : 'deaktiviert'}</span>
        <span class="text-xs text-slate-500">${c.uses}${c.max_uses ? '/' + c.max_uses : ''} genutzt${c.expires_at ? ' · bis ' + new Date(c.expires_at).toLocaleDateString('de-DE') : ''}${c.note ? ' · ' + esc(c.note) : ''}</span>
        <span class="ml-auto flex gap-1"><button data-copy="${esc(c.code)}" class="btn-ghost !px-2 !py-1 !text-xs">Link kopieren</button><button data-tog="${esc(c.code)}" data-on="${c.active}" class="btn-ghost !px-2 !py-1 !text-xs">${c.active ? 'Deaktivieren' : 'Aktivieren'}</button><button data-del="${esc(c.code)}" class="btn-ghost !px-2 !py-1 !text-xs !text-red-600">Löschen</button></span></div>`;
    }).join('') : '<p class="text-sm italic text-slate-400">Noch keine Codes.</p>';
    box.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => {
      const link = `${location.origin}/?invite=${b.dataset.copy}`;
      try { await navigator.clipboard.writeText(link); toast('Einladungslink kopiert', 'success'); } catch { prompt('Einladungslink:', link); }
    }));
    box.querySelectorAll('[data-tog]').forEach((b) => (b.onclick = () => busy(b, async () => { unwrap(await supabase.from('invite_codes').update({ active: b.dataset.on !== 'true' }).eq('code', b.dataset.tog)); loadInvites(el); })));
    box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { if (confirm(`Code ${b.dataset.del} löschen?`)) busy(b, async () => { unwrap(await supabase.from('invite_codes').delete().eq('code', b.dataset.del)); loadInvites(el); }); }));
  } catch (e) { box.innerHTML = `<p class="text-red-600">${esc(e.message)}</p>`; }
}

function inviteModal(done) {
  const { el, close } = openModal(`<h3 class="mb-3 text-lg font-bold">Neuer Einladungs-Code</h3>
    <form id="f" class="space-y-3"><div><label class="label">Notiz (optional)</label><input name="note" class="input" placeholder="z. B. Jugendgruppe 2026"></div>
    <div class="grid grid-cols-2 gap-2"><div><label class="label">Max. Nutzungen</label><input name="max" type="number" min="1" class="input" placeholder="unbegrenzt"></div>
    <div><label class="label">Gültig (Tage)</label><input name="days" type="number" min="0" class="input" value="14"></div></div>
    <p class="text-xs text-slate-500">0 Tage = unbegrenzt gültig.</p>
    <div class="flex justify-end gap-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Code erstellen</button></div></form>`);
  el.querySelector('#f').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      const code = unwrap(await supabase.rpc('create_invite', { p_max_uses: f.get('max') ? Number(f.get('max')) : null, p_days: Number(f.get('days')) || 0, p_note: f.get('note') }));
      close(); toast(`Code ${code} erstellt`, 'success'); done();
    }); };
}

// ----- Vollständige Sicherung (nur Admin): alle wichtigen Tabellen, ein Blatt pro Tabelle -----
async function fullBackup() {
  toast('Sicherung wird erstellt…');
  const all = (table, order) => fetchAll(() => supabase.from(table).select('*').order(order), 500000);
  const safe = async (table, order) => { try { return await all(table, order); } catch { return []; } };
  const json = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
  const sheet = (name, rows) => {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return { name, columns: keys.map((k) => ({ key: k, label: k })), rows: rows.map((r) => Object.fromEntries(keys.map((k) => [k, json(r[k])]))) };
  };
  const [rooms, items, rentals, log, profiles, perms, inv, ext] = await Promise.all([
    all('rooms', 'sort_order'), all('items', 'id'), all('rentals', 'start_at'), all('activity_log', 'created_at'),
    all('profiles', 'username'), safe('permissions', 'user_id'), safe('inventory_counts', 'created_at'), safe('extension_requests', 'created_at'),
  ]);
  await exportWorkbook('lager-sicherung', [
    sheet('Räume', rooms), sheet('Artikel', items), sheet('Ausleihen', rentals), sheet('Protokoll', log),
    sheet('Benutzer', profiles), sheet('Berechtigungen', perms), sheet('Inventuren', inv), sheet('Verlängerungen', ext),
  ]);
  toast(`Sicherung gespeichert (${items.length} Artikel, ${rentals.length} Ausleihen)`, 'success');
}
