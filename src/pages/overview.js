import { displayName } from '../lib/format.js';
import { supabase, unwrap } from '../lib/supabase.js';
import { esc, fmtDateTime, busy } from '../lib/ui.js';
import { state, GLOBAL_CHAT_ID, isManager, canManageRoom } from '../state.js';
import { openInspection, inspectionState } from '../components/inspection.js';
import { mountInstallHint } from '../components/installHint.js';
import { openScanner, routeScan } from '../components/scanner.js';
import { toast } from '../lib/ui.js';

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
  const names = Object.fromEntries((ids.length ? unwrap(await supabase.from('public_profiles').select('id, full_name, username').in('id', ids)) : []).map((p) => [p.id, displayName(p)]));
  let mfaHint = false;
  if (state.profile.role === 'admin') { const { data: fa } = await supabase.auth.mfa.listFactors(); mfaHint = !(fa?.totp || []).some((f) => f.status === 'verified'); }
  const dash = isManager() ? await managerDashboard() : null;
  const overdue = my.filter((r) => new Date(r.end_at) < new Date()).length;

  el.querySelector('#ov').innerHTML = `
    <section class="md:col-span-2 flex flex-wrap gap-2">
      <button id="qaScan" class="btn-primary">📷 Scannen</button>
      <a href="#/katalog" class="btn-ghost">📦 Katalog</a>
      <a href="#/kalender" class="btn-ghost">📅 Kalender</a>
      ${isManager() ? '<a href="#/terminal" class="btn-ghost">🛡️ Ausgabe / Rücknahme</a><a href="#/inventur" class="btn-ghost">📋 Inventur</a>' : ''}
    </section>
    <div id="installHint" class="md:col-span-2 empty:hidden"></div>
    ${dash ? dash.html : ''}
    ${mfaHint ? '<a href="#/einstellungen" class="card md:col-span-2 !border-amber-300 !bg-amber-50 text-sm font-semibold text-amber-800">🔐 Empfehlung: Aktiviere die Zwei-Faktor-Anmeldung für dein Administrator-Konto (Einstellungen → Sicherheit).</a>' : ''}
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
  el.querySelector('#qaScan').onclick = () => openScanner(routeScan);
  mountInstallHint(el.querySelector('#installHint'));
  el.querySelectorAll('[data-insp]').forEach((b) => (b.onclick = () => {
    const it = dash?.inspections.find((i) => i.id === b.dataset.insp);
    if (it) openInspection(it, () => render(el));
  }));
  el.querySelectorAll('[data-free]').forEach((b) => (b.onclick = () => busy(b, async () => {
    unwrap(await supabase.rpc('set_item_status', { p_item_id: b.dataset.free, p_status: 'active' }));
    toast('Artikel freigegeben', 'success'); render(el);
  })));
}

// ---------- Dashboard für Raum-Manager und Admins ----------
async function managerDashboard() {
  const room = state.profile.managed_room; const now = new Date();
  const endDay = new Date(now); endDay.setHours(24, 0, 0, 0);
  const sel = 'id, end_at, borrower_id, item_id, items(name, room_id)';
  const [od, today, maint, low, req, insp] = await Promise.all([
    supabase.from('rentals').select(sel).eq('status', 'active').lt('end_at', now.toISOString()).order('end_at').limit(30),
    supabase.from('rentals').select(sel).eq('status', 'active').gte('end_at', now.toISOString()).lt('end_at', endDay.toISOString()).order('end_at').limit(30),
    supabase.from('items').select('id, name, room_id').eq('status', 'maintenance').order('name').limit(30),
    supabase.from('catalog_items').select('id, name, room_id, stock_quantity, min_stock').eq('low_stock', true).order('name').limit(30),
    supabase.from('extension_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('catalog_items').select('id, name, room_id, next_inspection_at, inspection_interval_months, last_inspection_at').eq('inspection_due', true).order('next_inspection_at').limit(30),
  ]);
  const rows = (r) => (r.error ? [] : r.data);
  const inRoom = (rid) => !room || rid === room;
  const overdue = rows(od).filter((r) => inRoom(r.items?.room_id)); const due = rows(today).filter((r) => inRoom(r.items?.room_id));
  const broken = rows(maint).filter((i) => inRoom(i.room_id)); const lowStock = rows(low).filter((i) => inRoom(i.room_id)); const requests = req.count || 0;
  const inspections = rows(insp).filter((i) => inRoom(i.room_id) && canManageRoom(i.room_id));
  const ids = [...new Set([...overdue, ...due].map((r) => r.borrower_id))];
  const people = ids.length ? await supabase.from('public_profiles').select('id, full_name, username').in('id', ids) : { data: [] };
  const name = Object.fromEntries((people.data || []).map((p) => [p.id, displayName(p)]));

  const kpi = (n, label, color, href) => `<a href="${href}" class="card block text-center transition hover:shadow-md"><div class="text-3xl font-black ${n ? color : 'text-slate-300'}">${n}</div><div class="text-xs font-semibold text-slate-500">${label}</div></a>`;
  const panel = (title, body) => `<section class="card"><h2 class="mb-2 text-sm font-bold">${title}</h2><div class="space-y-1.5 text-sm">${body}</div></section>`;
  const rentalRow = (r) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="min-w-0"><b class="block truncate">${esc(r.items?.name)}</b><span class="text-xs text-slate-500">${esc(name[r.borrower_id] || '?')} · fällig ${fmtDateTime(r.end_at)}</span></span><a href="#/terminal?user=${esc(r.borrower_id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">Terminal</a></div>`;
  const parts = [];
  if (overdue.length) parts.push(panel(`⏰ Überfällig (${overdue.length})`, overdue.map(rentalRow).join('')));
  if (due.length) parts.push(panel(`📅 Heute fällig (${due.length})`, due.map(rentalRow).join('')));
  if (broken.length) parts.push(panel(`🛠 Defekt / Wartung (${broken.length})`, broken.map((i) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="truncate"><b>${esc(i.name)}</b> <span class="text-xs text-slate-400">${esc(i.room_id)}</span></span><button data-free="${esc(i.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">Freigeben</button></div>`).join('')));
  if (lowStock.length) parts.push(panel(`📉 Bestand niedrig (${lowStock.length})`, lowStock.map((i) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="truncate"><b>${esc(i.name)}</b> <span class="text-xs text-slate-400">${esc(i.room_id)}</span></span><span class="badge bg-red-100 text-red-700">${i.stock_quantity} / min. ${i.min_stock}</span></div>`).join('')));
  if (inspections.length) parts.push(panel(`🔧 Prüfung fällig (${inspections.length})`, inspections.map((i) => { const st = inspectionState(i); return `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="min-w-0"><b class="block truncate">${esc(i.name)}</b><span class="text-xs ${st?.level === 'due' ? 'text-red-600' : 'text-slate-500'}">${esc(st?.text || '')}</span></span><button data-insp="${esc(i.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">Prüfung eintragen</button></div>`; }).join('')));
  const html = `<section class="md:col-span-2"><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Arbeitsübersicht${room ? ' – ' + esc(room) : ''}</h2>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">${kpi(overdue.length, 'Überfällig', 'text-red-600', '#/terminal')}${kpi(due.length, 'Heute fällig', 'text-amber-600', '#/terminal')}${kpi(broken.length, 'Defekt / Wartung', 'text-red-600', '#/katalog')}${kpi(lowStock.length, 'Bestand niedrig', 'text-amber-600', '#/katalog')}${kpi(inspections.length, 'Prüfung fällig', 'text-amber-600', '#/katalog')}${kpi(requests, 'Offene Anträge', 'text-brand-600', '#/terminal')}</div></section>
    ${parts.length ? parts.join('') : '<section class="card md:col-span-2 text-center text-sm font-semibold text-emerald-700">✅ Alles in Ordnung – nichts überfällig, defekt oder knapp.</section>'}`;
  return { html, inspections };
}
