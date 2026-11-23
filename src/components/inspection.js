import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy, fmtDate } from '../lib/ui.js';

export { inspectionState } from '../lib/rules.js';
import { inspectionState } from '../lib/rules.js';

export const INTERVALS = [['', 'Keine regelmäßige Prüfung'], ['3', 'alle 3 Monate'], ['6', 'alle 6 Monate'], ['12', 'jährlich (z. B. Elektroprüfung)'], ['24', 'alle 2 Jahre'], ['36', 'alle 3 Jahre']];
export const intervalSelect = (cur) => {
  const v = cur == null ? '' : String(cur);
  const opts = INTERVALS.some(([x]) => x === v) ? INTERVALS : [...INTERVALS, [v, `alle ${v} Monate`]];
  return `<select name="interval" class="input">${opts.map(([x, l]) => `<option value="${x}" ${x === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
};

// Prüfung eintragen (bestanden / nicht bestanden)
export function openInspection(item, done) {
  const st = inspectionState(item);
  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">🔧 Prüfung eintragen</h3>
    <p class="mb-3 text-sm text-slate-500">${esc(item.name)} <span class="font-mono text-xs">${esc(item.id)}</span></p>
    <div class="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
      <div>Intervall: <b>${item.inspection_interval_months ? `${item.inspection_interval_months} Monate` : 'keins'}</b></div>
      <div>Letzte Prüfung: <b>${item.last_inspection_at ? fmtDate(item.last_inspection_at) : '–'}</b></div>
      ${st ? `<div class="${st.level === 'due' ? 'font-semibold text-red-600' : ''}">${esc(st.text)}</div>` : ''}
    </div>
    <form id="f" class="space-y-3">
      <div><label class="label">Ergebnis</label>
        <div class="grid grid-cols-2 gap-2"><label class="flex items-center gap-2 rounded-xl border p-2.5 text-sm font-semibold"><input type="radio" name="res" value="ok" checked> ✅ Bestanden</label>
        <label class="flex items-center gap-2 rounded-xl border p-2.5 text-sm font-semibold text-red-600"><input type="radio" name="res" value="fail"> ❌ Nicht bestanden</label></div></div>
      <div><label class="label">Bemerkung / Prüfprotokoll-Nr.</label><input name="note" class="input" placeholder="z. B. DGUV V3, Prüfer, Messwerte"></div>
      <p class="text-xs text-slate-500">„Nicht bestanden" sperrt den Artikel (Defekt / Wartung) und informiert die Verantwortlichen.</p>
      <div class="flex justify-end gap-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Speichern</button></div></form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      const next = unwrap(await supabase.rpc('record_inspection', { p_item_id: item.id, p_passed: f.get('res') === 'ok', p_note: f.get('note') }));
      close(); toast(next ? `Prüfung gespeichert – nächste am ${fmtDate(next)}` : 'Prüfung gespeichert', 'success'); done?.();
    });
  };
}
