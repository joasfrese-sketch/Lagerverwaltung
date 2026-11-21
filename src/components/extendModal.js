import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy, toLocalInput, fmtDateTime } from '../lib/ui.js';
import { canManageRoom } from '../state.js';
import { mountItemCalendar } from './itemCalendar.js';
import { extensionNeedsApproval, DAY, SELF_EXTEND_DAYS } from '../lib/rules.js';

// Frist verlängern: bis 3 Tage selbst (nicht bei überfälligen), sonst als Antrag; Verantwortliche immer direkt
export async function openExtend(rental, done) {
  const cur = new Date(rental.end_at);
  const manager = canManageRoom(rental.items?.room_id);
  const overdue = cur < new Date();
  const day = DAY;
  const first = new Date(Math.max(cur.getTime(), Date.now()) + day); first.setSeconds(0, 0);

  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">Frist verlängern</h3>
    <p class="mb-3 text-sm text-slate-500"><b>${esc(rental.items?.name)}</b> · aktuelle Frist ${fmtDateTime(rental.end_at)}${overdue ? ' <span class="badge bg-red-600 text-white">überfällig</span>' : ''}</p>
    <div class="grid gap-5 md:grid-cols-2">
      <form id="f" class="space-y-3">
        <div class="flex flex-wrap gap-1.5">${[1, 2, 3, 7].map((n) => `<button type="button" data-plus="${n}" class="btn-ghost !px-2.5 !py-1 !text-xs">+${n} Tag${n > 1 ? 'e' : ''}</button>`).join('')}</div>
        <div><label class="label">Neue Rückgabe</label><input id="ne" type="datetime-local" step="900" class="input" value="${toLocalInput(first)}" required></div>
        <div id="hint" class="rounded-xl p-2 text-xs"></div>
        <div id="reasonBox" class="hidden"><label class="label">Grund für den Antrag</label><textarea id="reason" class="input h-20" placeholder="Warum wird mehr Zeit benötigt?"></textarea></div>
        <div class="flex justify-end gap-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button id="go" class="btn-primary">Verlängern</button></div>
      </form>
      <div><h4 class="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Belegungsplan</h4><div id="cal"><p class="text-sm text-slate-400">Lade…</p></div></div>
    </div>`, { wide: true });
  const ne = el.querySelector('#ne'); const go = el.querySelector('#go'); const hint = el.querySelector('#hint');
  let cal = null;

  const evaluate = () => {
    const end = new Date(ne.value); const days = (end - cur) / day;
    const needsApproval = extensionNeedsApproval({ days, overdue, manager });
    el.querySelector('#reasonBox').classList.toggle('hidden', !needsApproval);
    go.textContent = needsApproval ? 'Antrag senden' : 'Verlängern';
    const clash = cal && end > cur ? cal.conflicts(cur, end) : [];
    let msg; let cls = 'bg-slate-50 text-slate-600';
    if (!(end > cur)) { msg = 'Das neue Datum muss nach der aktuellen Frist liegen.'; cls = 'bg-red-50 text-red-700'; }
    else if (clash.length) { msg = 'Der Artikel ist in diesem Zeitraum bereits reserviert.'; cls = 'bg-red-50 text-red-700'; }
    else if (needsApproval) { msg = overdue ? 'Die Ausleihe ist überfällig – die Verlängerung muss genehmigt werden.' : `Verlängerungen über ${SELF_EXTEND_DAYS} Tage (hier ${days.toFixed(1).replace('.', ',')}) müssen von der Raum-Verantwortung genehmigt werden.`; cls = 'bg-amber-50 text-amber-800'; }
    else { msg = '✅ Kann sofort verlängert werden.'; cls = 'bg-emerald-50 text-emerald-800'; }
    hint.className = `rounded-xl p-2 text-xs font-semibold ${cls}`; hint.textContent = msg;
    go.disabled = !(end > cur) || clash.length > 0;
    cal?.refresh();
  };
  el.querySelectorAll('[data-plus]').forEach((b) => (b.onclick = () => { ne.value = toLocalInput(new Date(cur.getTime() + Number(b.dataset.plus) * day)); evaluate(); }));
  ne.oninput = evaluate;
  cal = await mountItemCalendar(el.querySelector('#cal'), rental.item_id, {
    getRange: () => ({ start: cur, end: ne.value ? new Date(ne.value) : null }),
    onPickDay: (d) => { const n = new Date(d); n.setHours(cur.getHours(), cur.getMinutes(), 0, 0); if (n > cur) { ne.value = toLocalInput(n); evaluate(); } },
  });
  evaluate();

  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault();
    busy(go, async () => {
      const res = unwrap(await supabase.rpc('extend_rental', { p_rental_id: rental.id, p_new_end: new Date(ne.value).toISOString(), p_reason: el.querySelector('#reason').value }));
      close();
      toast(res === 'extended' ? 'Frist verlängert' : 'Antrag gesendet – du wirst benachrichtigt', 'success');
      done();
    });
  };
}
