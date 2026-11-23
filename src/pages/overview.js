import { displayName } from '../lib/format.js';
import { supabase, unwrap, safeData } from '../lib/supabase.js';
import { backupAgeDays } from '../lib/backupStatus.js';
import { esc, fmtDateTime, busy } from '../lib/ui.js';
import { state, GLOBAL_CHAT_ID, isManager, canManageRoom } from '../state.js';
import { openInspection, inspectionState } from '../components/inspection.js';
import { mountInstallHint } from '../components/installHint.js';
import { openScanner, routeScan } from '../components/scanner.js';
import { toast } from '../lib/ui.js';
import { collapsible, bindCollapsibles, openSection } from '../components/collapse.js';

const MFA_KEY = 'mfa_hint_until';
const mfaHidden = () => { try { return Number(localStorage.getItem(MFA_KEY) || 0) > Date.now(); } catch { return false; } };

export async function render(el) {
  el.innerHTML = `<h1 class="mb-4 text-2xl font-bold">Hallo, ${esc((state.profile.full_name || state.profile.username).split(' ')[0])} 👋</h1><div id="ov" class="grid items-start gap-3 md:grid-cols-2"><p class="text-sm text-slate-400">Lade…</p></div>`;
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
  if (state.profile.role === 'admin' && !mfaHidden()) { const { data: fa } = await supabase.auth.mfa.listFactors(); mfaHint = !(fa?.totp || []).some((f) => f.status === 'verified'); }
  const dash = isManager() ? await managerDashboard() : null;
  // Administratoren: Warnung, wenn die nächtliche Sicherung fehlt oder veraltet ist
  let bkWarn = '';
  if (state.profile.role === 'admin') {
    const last = (await safeData(supabase.from('backups').select('created_at').order('created_at', { ascending: false }).limit(1)))[0];
    const age = backupAgeDays(last?.created_at);
    if (age === null || age > 2) bkWarn = age === null ? 'Es gibt noch keine Sicherung im System.' : `Die letzte Sicherung ist ${Math.floor(age)} Tage alt.`;
  }
  const overdue = my.filter((r) => new Date(r.end_at) < new Date()).length;

  const late = (r) => new Date(r.end_at) < new Date();
  const row = (inner) => `<div class="mb-1.5 rounded-xl bg-slate-50 p-2.5 text-sm last:mb-0">${inner}</div>`;
  el.querySelector('#ov').innerHTML = `
    ${isManager() ? `<section class="grid grid-cols-[1.8fr_1fr] gap-2 md:col-span-2 md:flex"><a href="#/terminal" class="btn-primary whitespace-nowrap !py-2.5">🛡️ Ausgabe / Rücknahme</a><a href="#/inventur" class="btn-ghost whitespace-nowrap !py-2.5">📋 Inventur</a></section>` : ''}
    <div id="installHint" class="md:col-span-2 empty:hidden"></div>
    ${bkWarn ? `<a href="#/einstellungen" class="rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 md:col-span-2">⚠️ ${esc(bkWarn)} → Einstellungen › Betrieb &amp; Sicherung</a>` : ''}
    ${mfaHint ? '<div class="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 md:col-span-2"><a href="#/einstellungen" class="flex-1">🔐 Zwei-Faktor-Anmeldung für dein Admin-Konto aktivieren → Einstellungen › Sicherheit</a><button id="mfaOff" class="shrink-0 px-1 text-base leading-none" aria-label="Hinweis 7 Tage ausblenden">✕</button></div>' : ''}
    ${dash ? dash.kpis : ''}
    ${dash ? dash.panels : ''}
    ${collapsible({ id: 'ov-mine', title: '📦 Meine aktuellen Leihen', count: my.length, countCls: overdue ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600', hint: overdue ? `${overdue} überfällig` : '', open: true,
      body: my.length ? my.map((r) => row(`<b>${esc(r.items?.name)}</b>${late(r) ? ' <span class="badge bg-red-600 text-white">Überfällig</span>' : ''}<div class="text-xs text-slate-500">Bis ${fmtDateTime(r.end_at)}${r.project ? ' · ' + esc(r.project) : ''}</div>`)).join('') : '<p class="text-sm text-slate-500">Keine aktiven Ausleihen. <a href="#/katalog" class="font-semibold text-brand-700 underline">Im Katalog ausleihen →</a></p>' })}
    ${collapsible({ id: 'ov-notif', title: '🔔 Mitteilungen', count: nf.length, countCls: nf.length ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600', open: nf.length > 0,
      body: (nf.length ? nf.map((n) => `<div class="mb-1.5 rounded-xl bg-brand-50 p-2.5 text-sm"><b>${esc(n.title)}</b><div class="text-xs text-slate-600">${esc(n.body)}</div></div>`).join('') : '<p class="text-sm italic text-slate-400">Alles gelesen.</p>') + '<a href="#/chat" class="mt-1 block text-right text-xs font-semibold text-brand-700">Alle ansehen →</a>' })}
    ${collapsible({ id: 'ov-upcoming', title: '📅 Anstehende Belegungen', count: up.length,
      body: (up.length ? up.map((u) => `<div class="mb-1.5 flex justify-between gap-2 text-sm"><span class="truncate font-semibold">${esc(u.item_name)}</span><span class="shrink-0 text-xs text-slate-500">${fmtDateTime(u.start_at)}</span></div>`).join('') : '<p class="text-sm italic text-slate-400">Keine anstehenden Belegungen.</p>') + '<a href="#/kalender" class="mt-1 block text-right text-xs font-semibold text-brand-700">Zum Kalender →</a>' })}
    ${collapsible({ id: 'ov-chat', title: '💬 Gesamtchat', count: ms.length,
      body: (ms.length ? ms.reverse().map((m) => `<div class="mb-1.5 text-sm"><b>${esc(names[m.sender_id] || 'Unbekannt')}:</b> <span class="text-slate-600">${esc(m.body)}</span></div>`).join('') : '<p class="text-sm italic text-slate-400">Noch keine Nachrichten.</p>') + '<a href="#/chat" class="mt-1 block text-right text-xs font-semibold text-brand-700">Chat öffnen →</a>' })}`;
  bindCollapsibles(el);
  el.querySelector('#mfaOff')?.addEventListener('click', (e) => { try { localStorage.setItem(MFA_KEY, String(Date.now() + 7 * 86400000)); } catch { /* egal */ } e.target.closest('div').remove(); });
  // Kennzahl antippen = passende Liste aufklappen
  el.querySelectorAll('[data-kpi]').forEach((b) => (b.onclick = () => { if (!openSection(el, b.dataset.kpi) && b.dataset.href) location.hash = b.dataset.href; }));
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

  const kpi = (n, label, color, sec, href) => `<button data-kpi="${sec}" data-href="${href}" class="rounded-xl bg-slate-50 px-1 py-2 text-center transition hover:bg-slate-100"><div class="text-2xl font-black leading-none ${n ? color : 'text-slate-300'}">${n}</div><div class="mt-1 text-[13px] font-semibold leading-tight text-slate-500">${label}</div></button>`;
  const panel = (id, title, n, body, open = false, cls = 'bg-slate-100 text-slate-600') => collapsible({ id, title, count: n, countCls: cls, open, body: `<div class="space-y-1.5 text-sm">${body}</div>` });
  const rentalRow = (r) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="min-w-0"><b class="block truncate">${esc(r.items?.name)}</b><span class="text-xs text-slate-500">${esc(name[r.borrower_id] || '?')} · fällig ${fmtDateTime(r.end_at)}</span></span><a href="#/terminal?user=${esc(r.borrower_id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">Terminal</a></div>`;
  const parts = [];
  if (overdue.length) parts.push(panel('ov-overdue', '⏰ Überfällig', overdue.length, overdue.map(rentalRow).join(''), true, 'bg-red-600 text-white'));
  if (due.length) parts.push(panel('ov-due', '📅 Heute fällig', due.length, due.map(rentalRow).join('')));
  if (broken.length) parts.push(panel('ov-broken', '🛠 Defekt / Wartung', broken.length, broken.map((i) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="truncate"><b>${esc(i.name)}</b> <span class="text-xs text-slate-400">${esc(i.room_id)}</span></span><button data-free="${esc(i.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">Freigeben</button></div>`).join('')));
  if (lowStock.length) parts.push(panel('ov-low', '📉 Bestand niedrig', lowStock.length, lowStock.map((i) => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="truncate"><b>${esc(i.name)}</b> <span class="text-xs text-slate-400">${esc(i.room_id)}</span></span><span class="badge bg-red-100 text-red-700">${i.stock_quantity} / min. ${i.min_stock}</span></div>`).join('')));
  if (inspections.length) parts.push(panel('ov-insp', '🔧 Prüfung fällig', inspections.length, inspections.map((i) => { const st = inspectionState(i); return `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2"><span class="min-w-0"><b class="block truncate">${esc(i.name)}</b><span class="text-xs ${st?.level === 'due' ? 'text-red-600' : 'text-slate-500'}">${esc(st?.text || '')}</span></span><button data-insp="${esc(i.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">Prüfung eintragen</button></div>`; }).join('')));
  const allGood = !overdue.length && !due.length && !broken.length && !lowStock.length && !inspections.length;
  const kpis = `<section class="card md:col-span-2"><div class="mb-2 flex items-center justify-between"><h2 class="text-xs font-bold uppercase tracking-wide text-slate-500">Arbeitsübersicht${room ? ' – ' + esc(room) : ''}</h2>${allGood ? '<span class="text-xs font-semibold text-emerald-700">✅ alles in Ordnung</span>' : ''}</div>
    <div class="grid grid-cols-3 gap-2 lg:grid-cols-6">${kpi(overdue.length, 'Überfällig', 'text-red-600', 'ov-overdue', '#/terminal')}${kpi(due.length, 'Heute fällig', 'text-amber-600', 'ov-due', '#/terminal')}${kpi(broken.length, 'Defekt / Wartung', 'text-red-600', 'ov-broken', '#/katalog')}${kpi(lowStock.length, 'Bestand niedrig', 'text-amber-600', 'ov-low', '#/katalog')}${kpi(inspections.length, 'Prüfung fällig', 'text-amber-600', 'ov-insp', '#/katalog')}${kpi(requests, 'Offene Anträge', 'text-brand-700', 'none', '#/terminal')}</div></section>`;
  const html = kpis + parts.join('');
  return { html, kpis, panels: parts.join(''), inspections };
}
