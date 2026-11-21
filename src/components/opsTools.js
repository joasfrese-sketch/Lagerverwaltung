import { supabase, unwrap, safeData } from '../lib/supabase.js';
import { esc, toast, busy, fmtDateTime, openModal } from '../lib/ui.js';
import { exportRows } from '../lib/export.js';
import { backupAgeDays } from '../lib/backupStatus.js';

const KIND = { problem: '🐞 Problem', idee: '💡 Idee', lob: '👍 Lob' };
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

// Bereich „Betrieb & Sicherung“ für Administratoren: Sicherungen, Wiederherstellen, Protokoll aufräumen, Rückmeldungen, Fehlerberichte
export async function mountOps(box) {
  box.innerHTML = `
    <section class="mb-5"><h4 class="mb-1 font-bold">💾 Sicherungen im System</h4>
      <p class="mb-2 text-xs text-slate-500">Jede Nacht wird automatisch gesichert (14 Tage lückenlos, danach jeden Sonntag 12 Wochen lang). Zusätzlich solltest du ab und zu eine Sicherung herunterladen und an einem anderen Ort ablegen.</p>
      <div id="bkStatus" class="mb-2"></div><div class="mb-2"><button id="bkNow" class="btn-primary !py-1.5">Jetzt sichern</button></div><div id="bkList" class="space-y-1.5 text-sm"><p class="text-slate-500">Lade…</p></div></section>
    <section class="mb-5"><h4 class="mb-1 font-bold">🧹 Protokoll aufräumen</h4>
      <p class="mb-2 text-xs text-slate-500">Alte Protokolleinträge werden zuerst als Excel-Datei gespeichert und danach gelöscht. Nur Einträge älter als 90 Tage sind möglich.</p>
      <div class="flex flex-wrap items-center gap-2"><label class="text-sm" for="purgeAge">Einträge älter als</label><select id="purgeAge" class="input !w-auto"><option value="12">12 Monate</option><option value="24">24 Monate</option><option value="36">36 Monate</option><option value="6">6 Monate</option></select><button id="purge" class="btn-ghost">Prüfen …</button></div></section>
    <section class="mb-5"><h4 class="mb-1 font-bold">💬 Rückmeldungen</h4><div id="fbList" class="space-y-1.5 text-sm"><p class="text-slate-500">Lade…</p></div></section>
    <section><h4 class="mb-1 font-bold">🐞 Fehlerberichte der App</h4><p class="mb-2 text-xs text-slate-500">Unerwartete Fehler, die bei Nutzern aufgetreten sind (30 Tage).</p><div id="errList" class="space-y-1.5 text-xs"><p class="text-slate-500">Lade…</p></div></section>`;
  const reload = () => mountOps(box);

  // ----- Sicherungen -----
  const backups = await safeData(supabase.from('backups').select('id, created_at, kind, counts').order('created_at', { ascending: false }).limit(10));
  const age = backupAgeDays(backups[0]?.created_at);
  box.querySelector('#bkStatus').innerHTML = age === null ? '<p class="rounded-xl bg-red-50 p-2 text-sm font-semibold text-red-700">⚠️ Es gibt noch keine Sicherung im System.</p>'
    : age > 2 ? `<p class="rounded-xl bg-red-50 p-2 text-sm font-semibold text-red-700">⚠️ Die letzte Sicherung ist ${Math.floor(age)} Tage alt – bitte prüfen, ob der nächtliche Zeitplan läuft.</p>`
    : `<p class="rounded-xl bg-emerald-50 p-2 text-sm font-semibold text-emerald-800">✅ Letzte Sicherung: ${fmtDateTime(backups[0].created_at)}</p>`;
  box.querySelector('#bkList').innerHTML = backups.length ? backups.map((b) => `<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5">
      <span><b>${fmtDateTime(b.created_at)}</b> <span class="badge bg-slate-200 text-slate-700">${b.kind === 'manual' ? 'manuell' : 'automatisch'}</span><span class="block text-xs text-slate-500">${b.counts?.items ?? '?'} Artikel · ${b.counts?.rentals ?? '?'} Ausleihen · ${b.counts?.activity_log ?? '?'} Protokolleinträge</span></span>
      <span class="flex gap-1.5"><button data-dl="${esc(b.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">⬇️ Herunterladen</button><button data-rs="${esc(b.id)}" class="btn-ghost !px-2.5 !py-1 !text-xs">♻️ Gelöschtes zurückholen</button></span></div>`).join('') : '<p class="text-slate-500">Noch keine Sicherungen.</p>';
  box.querySelector('#bkNow').onclick = (e) => busy(e.target, async () => { unwrap(await supabase.rpc('create_backup', { p_kind: 'manual' })); toast('Sicherung angelegt', 'success'); reload(); });
  box.querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => busy(b, async () => {
    const row = unwrap(await supabase.from('backups').select('created_at, data').eq('id', b.dataset.dl).single());
    download(new Blob([JSON.stringify({ format: 'lager-backup', created_at: row.created_at, ...row.data }, null, 1)], { type: 'application/json' }), `lager-sicherung-${row.created_at.slice(0, 16).replace(/[:T]/g, '-')}.json`);
  })));
  box.querySelectorAll('[data-rs]').forEach((b) => (b.onclick = () => {
    if (!confirm('Aus dieser Sicherung werden nur GELÖSCHTE Räume, Artikel, Ausleihen und Inventuren wieder angelegt. Bestehendes wird nicht verändert. Fortfahren?')) return;
    busy(b, async () => {
      const r = unwrap(await supabase.rpc('restore_deleted_from_backup', { p_id: b.dataset.rs }));
      const lines = Object.entries(r).map(([k, v]) => `${k}: ${v['wiederhergestellt']} wiederhergestellt${v['übersprungen'] ? `, ${v['übersprungen']} übersprungen` : ''}`);
      openModal(`<h3 class="mb-2 text-lg font-bold">Wiederherstellung abgeschlossen</h3><ul class="mb-3 space-y-1 text-sm">${lines.map((l) => `<li class="rounded-xl bg-slate-50 p-2">${esc(l)}</li>`).join('')}</ul><button data-close class="btn-primary w-full">OK</button>`);
    });
  }));

  // ----- Protokoll aufräumen -----
  box.querySelector('#purge').onclick = (e) => busy(e.target, async () => {
    const months = Number(box.querySelector('#purgeAge').value);
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
    const iso = cutoff.toISOString();
    const rows = unwrap(await supabase.from('activity_log').select('*').lt('created_at', iso).order('created_at').limit(50000));
    if (!rows.length) return toast('Keine Einträge, die so alt sind.', 'info');
    if (!confirm(`${rows.length} Protokolleinträge (älter als ${months} Monate) werden zuerst als Excel-Datei gespeichert und danach gelöscht. Fortfahren?`)) return;
    await exportRows('protokoll-archiv', [{ key: 'zeit', label: 'Zeit' }, { key: 'aktion', label: 'Aktion' }, { key: 'id', label: 'Artikel-ID' }, { key: 'artikel', label: 'Artikel' }, { key: 'details', label: 'Details (JSON)' }],
      rows.map((l) => ({ zeit: fmtDateTime(l.created_at), aktion: l.action, id: l.item_id || '', artikel: l.item_name || '', details: JSON.stringify(l.details || {}) })), 'xlsx');
    if (!confirm('Wurde die Excel-Datei heruntergeladen und gespeichert? Erst dann werden die Einträge endgültig gelöscht.')) return toast('Abgebrochen – nichts gelöscht.', 'info');
    const n = unwrap(await supabase.rpc('purge_activity_log', { p_before: iso, p_expected: rows.length }));
    toast(`${n} Einträge archiviert und gelöscht`, 'success');
  });

  // ----- Rückmeldungen -----
  const fb = await safeData(supabase.from('feedback').select('id, kind, message, page, status, created_at, profiles(full_name, username)').order('created_at', { ascending: false }).limit(30));
  box.querySelector('#fbList').innerHTML = fb.length ? fb.map((f) => `<div class="rounded-xl bg-slate-50 p-2.5 ${f.status === 'erledigt' ? 'opacity-70' : ''}">
      <div class="flex flex-wrap items-center justify-between gap-2"><span><b>${KIND[f.kind] || esc(f.kind)}</b> · ${esc(f.profiles?.full_name || f.profiles?.username || '?')} · <span class="text-xs text-slate-500">${fmtDateTime(f.created_at)}${f.page ? ' · ' + esc(f.page) : ''}</span></span>
        <select data-st="${esc(f.id)}" aria-label="Status" class="input !w-auto !py-1 text-xs">${['neu', 'gesehen', 'erledigt'].map((s) => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <p class="mt-1 whitespace-pre-line">${esc(f.message)}</p></div>`).join('') : '<p class="text-slate-500">Noch keine Rückmeldungen.</p>';
  box.querySelectorAll('[data-st]').forEach((s) => (s.onchange = () => busy(null, async () => { unwrap(await supabase.from('feedback').update({ status: s.value }).eq('id', s.dataset.st)); toast('Gespeichert', 'success'); })));

  // ----- Fehlerberichte -----
  const errs = await safeData(supabase.from('client_errors').select('id, message, page, agent, created_at').order('created_at', { ascending: false }).limit(20));
  box.querySelector('#errList').innerHTML = errs.length ? errs.map((x) => `<div class="rounded-xl bg-slate-50 p-2"><b>${esc(x.message)}</b><div class="text-slate-500">${fmtDateTime(x.created_at)} · ${esc(x.page || '')}</div></div>`).join('') : '<p class="text-slate-500">Keine Fehler gemeldet. 🎉</p>';
}
