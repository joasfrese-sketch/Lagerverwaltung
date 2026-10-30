import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, busy, fmtDateTime, fmtDate } from '../lib/ui.js';
import { state, isManager } from '../state.js';
import { openScanner, routeScan } from '../components/scanner.js';

export async function render(el) {
  if (!isManager()) { el.innerHTML = '<div class="card text-center text-slate-500">Nur für Raum-Manager und Administratoren.</div>'; return; }
  const people = unwrap(await supabase.from('public_profiles').select('id, full_name, username').order('full_name'));
  const label = (p) => `${p.full_name || p.username} (@${p.username})`;
  const preset = new URLSearchParams(location.hash.split('?')[1] || '').get('user');

  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2"><h1 class="mr-auto text-2xl font-bold">🛡️ Lagerwart-Terminal</h1>
      <button id="scanUser" class="btn-ghost">🪪 Personen-QR scannen</button><button id="scanItem" class="btn-ghost">📷 Artikel scannen</button></div>
    <div class="card space-y-3">
      <div><label class="label">Ausleiher / Person</label>
        <input id="q" class="input mb-2" placeholder="Name oder Benutzername suchen…"><select id="who" class="input" size="1"></select></div>
      <div id="rentals" class="space-y-2"></div>
      <div class="grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-2">
        <div><label class="label">Abgebende Person (Drittperson möglich)</label><select id="by" class="input"><option value="">Ausleiher selbst</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('')}</select></div>
        <div><label class="label">Notiz / Vermerk</label><input id="note" class="input" placeholder="z. B. Kabel vollständig"></div>
        <label class="flex items-center gap-2 text-sm font-semibold md:col-span-2"><input type="checkbox" id="prot" checked> Übergabeprotokoll danach drucken</label>
      </div>
      <div class="flex justify-end"><button id="go" class="btn-primary">✅ Ausgewählte zurücknehmen</button></div>
    </div>`;

  const who = el.querySelector('#who');
  const fill = (term = '') => {
    const t = term.toLowerCase();
    const f = people.filter((p) => !t || label(p).toLowerCase().includes(t));
    who.innerHTML = f.map((p) => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('') || '<option value="">Keine Treffer</option>';
    if (preset && f.some((p) => p.id === preset)) who.value = preset;
  };
  fill();
  let rows = [];
  const loadRentals = async () => {
    const box = el.querySelector('#rentals');
    if (!who.value) { box.innerHTML = ''; return; }
    try {
      rows = unwrap(await supabase.from('rentals').select('id, item_id, start_at, end_at, project, items(name, room_id)').eq('borrower_id', who.value).eq('status', 'active').order('end_at'));
      box.innerHTML = rows.length ? `<label class="flex items-center gap-2 text-xs font-bold text-brand-600"><input type="checkbox" id="all" checked> Alle auswählen</label>` + rows.map((r) => {
        const late = new Date(r.end_at) < new Date();
        return `<label class="flex items-center gap-3 rounded-xl border p-2.5 ${late ? 'border-red-300 bg-red-50' : 'bg-white'}"><input type="checkbox" class="rc" value="${esc(r.id)}" checked>
          <span class="text-sm"><b>${esc(r.items?.name)}</b> <span class="font-mono text-xs text-slate-400">${esc(r.item_id)}</span>${late ? ' <span class="badge bg-red-600 text-white">Überfällig</span>' : ''}<br><span class="text-xs text-slate-500">Frist ${fmtDateTime(r.end_at)}${r.project ? ' · ' + esc(r.project) : ''}</span></span></label>`;
      }).join('') : '<p class="rounded-xl bg-slate-50 p-4 text-center text-sm italic text-slate-400">Keine aktiven Ausleihen (in deinen Räumen).</p>';
      box.querySelector('#all')?.addEventListener('change', (e) => box.querySelectorAll('.rc').forEach((c) => (c.checked = e.target.checked)));
    } catch (e) { toast(e.message, 'error'); }
  };
  who.onchange = loadRentals;
  el.querySelector('#q').oninput = (e) => { fill(e.target.value); loadRentals(); };
  el.querySelector('#scanUser').onclick = () => openScanner(routeScan);
  el.querySelector('#scanItem').onclick = () => openScanner(routeScan);
  el.querySelector('#go').onclick = (e) => busy(e.target, async () => {
    const ids = [...el.querySelectorAll('.rc:checked')].map((c) => c.value);
    if (!ids.length) throw new Error('Bitte mindestens ein Objekt auswählen.');
    const by = el.querySelector('#by').value || who.value;
    const note = el.querySelector('#note').value;
    const picked = rows.filter((r) => ids.includes(r.id));
    const n = unwrap(await supabase.rpc('return_rentals', { p_rental_ids: ids, p_returned_by: by, p_note: note }));
    toast(`${n} Objekt(e) zurückgenommen`, 'success');
    if (el.querySelector('#prot').checked) printProtocol(people.find((p) => p.id === who.value), people.find((p) => p.id === by), picked, note);
    loadRentals();
  });
  loadRentals();
}

function printProtocol(borrower, returnedBy, rows, note) {
  const w = window.open('', '_blank');
  if (!w) return toast('Pop-up blockiert – Protokoll konnte nicht geöffnet werden.', 'error');
  const nm = (p) => esc(p ? p.full_name || p.username : '–');
  w.document.write(`<html><head><title>Übergabeprotokoll</title><style>body{font-family:sans-serif;padding:24px;color:#0f172a}h1{margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border:1px solid #cbd5e1;padding:6px;text-align:left;font-size:13px}.s{display:flex;gap:40px;margin-top:70px}.s div{flex:1;border-top:1px solid #64748b;padding-top:6px;font-size:12px;text-align:center}</style></head><body>
  <h1>Rückgabe-Protokoll</h1><p>Lagerverwaltung Pro · ${fmtDate(new Date().toISOString())} · ID PRT-${Date.now().toString().slice(-6)}</p>
  <p><b>Ausleiher:</b> ${nm(borrower)}<br><b>Abgegeben durch:</b> ${nm(returnedBy)}<br><b>Angenommen von:</b> ${esc(state.profile.full_name || state.profile.username)}</p>
  <table><tr><th>ID</th><th>Bezeichnung</th><th>Frist</th></tr>${rows.map((r) => `<tr><td>${esc(r.item_id)}</td><td>${esc(r.items?.name)}</td><td>${fmtDateTime(r.end_at)}</td></tr>`).join('')}</table>
  ${note ? `<p><b>Vermerk:</b> ${esc(note)}</p>` : ''}
  <div class="s"><div>Unterschrift Ausleiher / Abgebender</div><div>Unterschrift Lagerwart</div></div><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}
