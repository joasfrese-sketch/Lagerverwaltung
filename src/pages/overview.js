import { supabase, unwrap } from '../lib/supabase.js';
import { esc, fmtDateTime } from '../lib/ui.js';
import { state, GLOBAL_CHAT_ID } from '../state.js';

export async function render(el) {
  el.innerHTML = `<h1 class="mb-4 text-2xl font-bold">Hallo, ${esc((state.profile.full_name || state.profile.username).split(' ')[0])} 👋</h1><div id="ov" class="grid gap-4 md:grid-cols-2"><p class="text-sm text-slate-400">Lade…</p></div>`;
  const nowIso = new Date().toISOString();
  const [rentals, notifs, upcoming, msgs] = await Promise.all([
    supabase.from('rentals').select('id, end_at, start_at, project, items(name)').eq('borrower_id', state.user.id).eq('status', 'active').order('end_at'),
    supabase.from('notifications').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(5),
    supabase.from('rental_calendar').select('id, item_name, start_at, end_at, borrower_name').eq('status', 'active').gte('end_at', nowIso).order('start_at').limit(5),
    supabase.from('chat_messages').select('body, sender_id, created_at').eq('chat_id', GLOBAL_CHAT_ID).order('created_at', { ascending: false }).limit(4),
  ]);
  const my = unwrap(rentals), nf = unwrap(notifs), up = unwrap(upcoming), ms = unwrap(msgs);
  const ids = [...new Set(ms.map((m) => m.sender_id))];
  const names = Object.fromEntries((ids.length ? unwrap(await supabase.from('public_profiles').select('id, full_name, username').in('id', ids)) : []).map((p) => [p.id, p.full_name || p.username]));
  const overdue = my.filter((r) => new Date(r.end_at) < new Date()).length;

  el.querySelector('#ov').innerHTML = `
    <section class="card grid grid-cols-3 gap-3 text-center md:col-span-2">
      <div><div class="text-2xl font-black">${my.length}</div><div class="text-xs text-slate-500">Aktive Leihen</div></div>
      <div><div class="text-2xl font-black ${overdue ? 'text-red-600' : ''}">${overdue}</div><div class="text-xs text-slate-500">Überfällig</div></div>
      <div><div class="text-2xl font-black">${nf.length}</div><div class="text-xs text-slate-500">Neue Mitteilungen</div></div>
    </section>
    <section class="card"><h2 class="mb-2 text-sm font-bold">📦 Meine aktuellen Leihen</h2>
      ${my.length ? my.map((r) => `<div class="mb-2 rounded-xl bg-slate-50 p-2.5 text-sm"><b>${esc(r.items?.name)}</b>${new Date(r.end_at) < new Date() ? ' <span class="badge bg-red-600 text-white">Überfällig</span>' : ''}<div class="text-xs text-slate-500">Bis ${fmtDateTime(r.end_at)}${r.project ? ' · ' + esc(r.project) : ''}</div></div>`).join('') : '<p class="text-sm italic text-slate-400">Keine aktiven Ausleihen.</p>'}
    </section>
    <section class="card"><div class="mb-2 flex items-center justify-between"><h2 class="text-sm font-bold">🔔 Mitteilungen</h2><a href="#/chat" class="text-xs font-semibold text-brand-600">Alle →</a></div>
      ${nf.length ? nf.map((n) => `<div class="mb-2 rounded-xl bg-brand-50 p-2.5 text-sm"><b>${esc(n.title)}</b><div class="text-xs text-slate-600">${esc(n.body)}</div></div>`).join('') : '<p class="text-sm italic text-slate-400">Alles gelesen.</p>'}
    </section>
    <section class="card"><div class="mb-2 flex items-center justify-between"><h2 class="text-sm font-bold">📅 Anstehende Belegungen</h2><a href="#/kalender" class="text-xs font-semibold text-brand-600">Kalender →</a></div>
      ${up.length ? up.map((u) => `<div class="mb-1.5 flex justify-between gap-2 text-sm"><span class="truncate font-semibold">${esc(u.item_name)}</span><span class="shrink-0 text-xs text-slate-500">${fmtDateTime(u.start_at)}</span></div>`).join('') : '<p class="text-sm italic text-slate-400">Keine anstehenden Belegungen.</p>'}
    </section>
    <section class="card"><div class="mb-2 flex items-center justify-between"><h2 class="text-sm font-bold">💬 Gesamtchat</h2><a href="#/chat" class="text-xs font-semibold text-brand-600">Öffnen →</a></div>
      ${ms.length ? ms.reverse().map((m) => `<div class="mb-1.5 text-sm"><b>${esc(names[m.sender_id] || 'Unbekannt')}:</b> <span class="text-slate-600">${esc(m.body)}</span></div>`).join('') : '<p class="text-sm italic text-slate-400">Noch keine Nachrichten.</p>'}
    </section>`;
}
