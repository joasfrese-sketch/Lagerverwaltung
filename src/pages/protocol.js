import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, fmtDateTime } from '../lib/ui.js';
import { displayName } from '../lib/format.js';
import { isManager } from '../state.js';
import { fetchAll } from '../lib/export.js';
import { openExport } from '../components/exportDialog.js';
import { icon } from '../lib/icons.js';

const PAGE = 50;
const ACTIONS = ['AUSLEIHE', 'RÜCKGABE', 'DEFEKT', 'STATUS', 'ENTNAHME', 'GELÖSCHT', 'VERLÄNGERUNG'];
const F = { from: '', to: '', action: '', who: '', q: '', page: 0 };

export async function render(el) {
  if (!isManager()) { el.innerHTML = '<div class="card text-center text-slate-500">Nur für Raum-Manager und Administratoren.</div>'; return; }
  const people = unwrap(await supabase.from('public_profiles').select('id, full_name, username').order('full_name'));
  const name = Object.fromEntries(people.map((p) => [p.id, displayName(p)]));
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2"><h1 class="mr-auto text-2xl font-bold">Protokoll</h1><button id="exp" class="btn-ghost">${icon('download', 'h-4 w-4')} Export</button></div>
    <div class="card mb-4 grid gap-2 md:grid-cols-6">
      <div><label class="label">Von</label><input id="fFrom" type="date" class="input" value="${F.from}"></div>
      <div><label class="label">Bis</label><input id="fTo" type="date" class="input" value="${F.to}"></div>
      <div><label class="label">Aktion</label><select id="fAct" class="input"><option value="">Alle</option>${ACTIONS.map((a) => `<option ${a === F.action ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
      <div><label class="label">Person</label><select id="fWho" class="input"><option value="">Alle</option>${people.map((p) => `<option value="${esc(p.id)}" ${p.id === F.who ? 'selected' : ''}>${esc(displayName(p))}</option>`).join('')}</select></div>
      <div class="md:col-span-2"><label class="label">Artikel</label><input id="fQ" class="input" placeholder="Name oder ID" value="${esc(F.q)}"></div></div>
    <div class="card overflow-x-auto !p-0"><table class="w-full min-w-[640px] text-left text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-3">Zeit</th><th class="p-3">Aktion</th><th class="p-3">Artikel</th><th class="p-3">Beteiligte</th><th class="p-3">Details</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="p-4 text-slate-400">Lade…</td></tr></tbody></table></div>
    <div class="mt-3 flex items-center justify-between text-sm"><button id="prev" class="btn-ghost">← Zurück</button><span id="pg" class="text-xs text-slate-500"></span><button id="next" class="btn-ghost">Weiter →</button></div>`;

  const query = (q) => {
    if (F.from) q = q.gte('created_at', new Date(F.from).toISOString());
    if (F.to) { const d = new Date(F.to); d.setDate(d.getDate() + 1); q = q.lt('created_at', d.toISOString()); }
    if (F.action) q = q.eq('action', F.action);
    if (F.who) q = q.or(`actor_id.eq.${F.who},subject_id.eq.${F.who}`);
    const t = F.q.trim().replace(/[%,()]/g, ' ');
    if (t) q = q.or(`item_name.ilike.%${t}%,item_id.ilike.%${t}%`);
    return q;
  };
  const detail = (d = {}) => [
    d.project && `Projekt: ${d.project}`, d.note && `Notiz: ${d.note}`, d.damage && `Schaden: ${d.damage}`,
    d.status && `Status: ${d.status}`, d.qty != null && `Menge: ${d.qty}${d.remaining != null ? ` (Rest ${d.remaining})` : ''}`, d.reason && `Grund: ${d.reason}`,
    d.returned_by && `abgegeben durch ${name[d.returned_by] || '?'}`, d.room && `Raum: ${d.room}`,
  ].filter(Boolean).join(' · ');

  async function load() {
    try {
      const { data, count, error } = await query(supabase.from('activity_log').select('*', { count: 'exact' })).order('created_at', { ascending: false }).range(F.page * PAGE, F.page * PAGE + PAGE - 1);
      if (error) throw new Error(error.message);
      el.querySelector('#rows').innerHTML = data.length ? data.map((l) => `<tr class="border-t"><td class="whitespace-nowrap p-3 text-slate-500">${fmtDateTime(l.created_at)}</td><td class="p-3"><span class="badge bg-slate-100 text-slate-700">${esc(l.action)}</span></td>
        <td class="p-3"><b>${esc(l.item_name || '–')}</b><div class="font-mono text-[10px] text-slate-400">${esc(l.item_id || '')}</div></td>
        <td class="p-3">${esc(name[l.actor_id] || '–')}${l.subject_id && l.subject_id !== l.actor_id ? ` <span class="text-slate-400">→</span> ${esc(name[l.subject_id] || '?')}` : ''}</td><td class="p-3 text-slate-600">${esc(detail(l.details))}</td></tr>`).join('')
        : '<tr><td colspan="5" class="p-6 text-center italic text-slate-400">Keine Einträge.</td></tr>';
      const pages = Math.max(1, Math.ceil((count || 0) / PAGE));
      el.querySelector('#pg').textContent = `Seite ${F.page + 1} von ${pages} · ${count || 0} Einträge`;
      el.querySelector('#prev').disabled = F.page === 0;
      el.querySelector('#next').disabled = F.page + 1 >= pages;
    } catch (e) { toast(e.message, 'error'); }
  }
  const apply = () => { F.page = 0; load(); };
  el.querySelector('#fFrom').onchange = (e) => { F.from = e.target.value; apply(); };
  el.querySelector('#fTo').onchange = (e) => { F.to = e.target.value; apply(); };
  el.querySelector('#fAct').onchange = (e) => { F.action = e.target.value; apply(); };
  el.querySelector('#fWho').onchange = (e) => { F.who = e.target.value; apply(); };
  let t; el.querySelector('#fQ').oninput = (e) => { F.q = e.target.value; clearTimeout(t); t = setTimeout(apply, 300); };
  el.querySelector('#prev').onclick = () => { F.page--; load(); };
  el.querySelector('#next').onclick = () => { F.page++; load(); };
  el.querySelector('#exp').onclick = () => openExport({
    title: 'Protokoll exportieren', filename: 'protokoll',
    load: async () => {
      const rows = await fetchAll(() => query(supabase.from('activity_log').select('*')).order('created_at', { ascending: false }));
      return {
        columns: [{ key: 'zeit', label: 'Zeit' }, { key: 'aktion', label: 'Aktion' }, { key: 'id', label: 'Artikel-ID' }, { key: 'artikel', label: 'Artikel' }, { key: 'von', label: 'Durchgeführt von' }, { key: 'fuer', label: 'Betroffene Person' }, { key: 'details', label: 'Details' }],
        rows: rows.map((l) => ({ zeit: fmtDateTime(l.created_at), aktion: l.action, id: l.item_id, artikel: l.item_name, von: name[l.actor_id] || '', fuer: name[l.subject_id] || '', details: detail(l.details) })),
      };
    },
  });
  load();
}
