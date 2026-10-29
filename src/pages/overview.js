import { supabase, unwrap } from '../lib/supabase.js';
import { esc, fmtDateTime } from '../lib/ui.js';
import { state } from '../state.js';

export async function render(el) {
  el.innerHTML = `<h1 class="mb-4 text-2xl font-bold">Hallo, ${esc((state.profile.full_name || state.profile.username).split(' ')[0])} 👋</h1><div id="ov" class="grid gap-4 md:grid-cols-2"><p class="text-sm text-slate-400">Lade…</p></div>`;
  try {
    const rentals = unwrap(await supabase.from('rentals').select('id, end_at, start_at, project, items(name)')
      .eq('borrower_id', state.user.id).eq('status', 'active').order('end_at'));
    const notifs = unwrap(await supabase.from('notifications').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(5));
    const overdue = rentals.filter((r) => new Date(r.end_at) < new Date()).length;

    el.querySelector('#ov').innerHTML = `
      <section class="card md:col-span-2 grid grid-cols-3 gap-3 text-center">
        <div><div class="text-2xl font-black">${rentals.length}</div><div class="text-xs text-slate-500">Aktive Leihen</div></div>
        <div><div class="text-2xl font-black ${overdue ? 'text-red-600' : ''}">${overdue}</div><div class="text-xs text-slate-500">Überfällig</div></div>
        <div><div class="text-2xl font-black">${notifs.length}</div><div class="text-xs text-slate-500">Neue Mitteilungen</div></div>
      </section>
      <section class="card"><h2 class="mb-2 text-sm font-bold">📦 Meine aktuellen Leihen</h2>
        ${rentals.length ? rentals.map((r) => `<div class="mb-2 rounded-xl bg-slate-50 p-2.5 text-sm"><b>${esc(r.items?.name)}</b>${new Date(r.end_at) < new Date() ? ' <span class="badge bg-red-600 text-white">Überfällig</span>' : ''}<div class="text-xs text-slate-500">Bis ${fmtDateTime(r.end_at)}${r.project ? ' · ' + esc(r.project) : ''}</div></div>`).join('') : '<p class="text-sm italic text-slate-400">Keine aktiven Ausleihen.</p>'}
      </section>
      <section class="card"><h2 class="mb-2 text-sm font-bold">🔔 Mitteilungen</h2>
        ${notifs.length ? notifs.map((n) => `<div class="mb-2 rounded-xl bg-brand-50 p-2.5 text-sm"><b>${esc(n.title)}</b><div class="text-xs text-slate-600">${esc(n.body)}</div></div>`).join('') : '<p class="text-sm italic text-slate-400">Alles gelesen.</p>'}
      </section>
      <section class="card text-sm text-slate-400">📅 Kalender- und 💬 Chat-Ausschnitt folgen mit den jeweiligen Seiten.</section>`;
  } catch (e) { el.querySelector('#ov').innerHTML = `<p class="text-red-600">${esc(e.message)}</p>`; }
}
