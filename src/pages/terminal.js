import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, busy, openModal, fmtDateTime, fmtDate, toLocalInput } from '../lib/ui.js';
import { state, isManager } from '../state.js';
import { openScanner, routeScan } from '../components/scanner.js';

export async function render(el) {
  if (!isManager()) { el.innerHTML = '<div class="card text-center text-slate-500">Nur für Raum-Manager und Administratoren.</div>'; return; }
  const people = unwrap(await supabase.from('public_profiles').select('id, full_name, username').order('full_name'));
  const nameOf = (id) => { const p = people.find((x) => x.id === id); return p ? p.full_name || p.username : 'Unbekannt'; };
  const label = (p) => `${p.full_name || p.username} (@${p.username})`;
  const preset = new URLSearchParams(location.hash.split('?')[1] || '').get('user');
  const start = new Date(); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);

  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2"><h1 class="mr-auto text-2xl font-bold">🛡️ Lagerwart-Terminal</h1>
      <button id="scanUser" class="btn-ghost">🪪 Personen-QR scannen</button></div>

    <div class="card mb-4 space-y-2"><h2 class="font-bold">Person (Ausleiher)</h2>
      <input id="q" class="input" placeholder="Name oder Benutzername suchen…"><select id="who" class="input"></select></div>

    <div class="card mb-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-bold">📷 Mehrfachscan</h2>
        <div id="modeSeg" class="flex rounded-xl bg-slate-100 p-0.5 text-sm font-semibold"><button data-mode="out" class="rounded-lg px-3 py-1.5">📤 Ausgabe</button><button data-mode="in" class="rounded-lg px-3 py-1.5">📥 Rücknahme</button></div></div>
      <p id="modeHint" class="text-xs text-slate-500"></p>
      <div id="outFields" class="grid gap-2 md:grid-cols-3">
        <div><label class="label">Beginn</label><input id="mStart" type="datetime-local" step="900" class="input" value="${toLocalInput(start)}"></div>
        <div><label class="label">Rückgabe</label><input id="mEnd" type="datetime-local" step="900" class="input" value="${toLocalInput(end)}"></div>
        <div><label class="label">Projekt (optional)</label><input id="mProject" class="input"></div></div>
      <div id="inFields" class="grid gap-2 md:grid-cols-2">
        <div><label class="label">Abgebende Person (optional, sonst Ausleiher selbst)</label><select id="mBy" class="input"><option value="">Ausleiher selbst</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('')}</select></div>
        <div><label class="label">Notiz</label><input id="mNote" class="input"></div></div>
      <div class="flex flex-wrap gap-2"><button id="camScan" class="btn-primary">📷 Kamera-Scan starten</button>
        <form id="codeForm" class="flex flex-1 gap-2"><input id="codeIn" class="input" placeholder="Code scannen/eintippen + Enter (auch USB-Scanner)" autocomplete="off"><button class="btn-ghost">Hinzufügen</button></form></div>
      <div id="cart" class="space-y-1.5"></div>
      <div class="flex flex-wrap items-center justify-between gap-2"><label class="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" id="mProt" checked> Protokoll danach drucken</label>
        <div class="flex gap-2"><button id="mClear" class="btn-ghost">Leeren</button><button id="mGo" class="btn-primary" disabled>Buchen</button></div></div>
    </div>

    <div class="card space-y-3"><h2 class="font-bold">Aktuelle Leihen dieser Person</h2>
      <div id="rentals" class="space-y-2"></div>
      <div class="grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-2">
        <div><label class="label">Abgebende Person</label><select id="by" class="input"><option value="">Ausleiher selbst</option>${people.map((p) => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('')}</select></div>
        <div><label class="label">Notiz / Vermerk</label><input id="note" class="input"></div>
        <label class="flex items-center gap-2 text-sm font-semibold md:col-span-2"><input type="checkbox" id="prot" checked> Protokoll danach drucken</label></div>
      <div class="flex justify-end"><button id="go" class="btn-primary">✅ Ausgewählte zurücknehmen</button></div></div>`;

  const who = el.querySelector('#who');
  const fill = (term = '') => {
    const t = term.toLowerCase();
    const f = people.filter((p) => !t || label(p).toLowerCase().includes(t));
    const keep = who.value;
    who.innerHTML = f.map((p) => `<option value="${esc(p.id)}">${esc(label(p))}</option>`).join('') || '<option value="">Keine Treffer</option>';
    if (preset && f.some((p) => p.id === preset) && !keep) who.value = preset;
    else if (f.some((p) => p.id === keep)) who.value = keep;
  };
  fill();

  // ================= Mehrfachscan =================
  let mode = 'out'; let cart = [];
  const hint = { out: 'Person oben wählen (oder Personen-QR scannen), dann Artikel nacheinander scannen und gesammelt ausgeben.', in: 'Artikel nacheinander scannen – alle werden gesammelt zurückgenommen, auch von unterschiedlichen Personen.' };
  const drawMode = () => {
    el.querySelectorAll('[data-mode]').forEach((b) => (b.className = `rounded-lg px-3 py-1.5 ${b.dataset.mode === mode ? 'bg-brand-600 text-white' : 'text-slate-600'}`));
    el.querySelector('#modeHint').textContent = hint[mode];
    el.querySelector('#outFields').classList.toggle('hidden', mode !== 'out');
    el.querySelector('#inFields').classList.toggle('hidden', mode !== 'in');
    el.querySelector('#mGo').textContent = mode === 'out' ? '📤 Ausgabe buchen' : '📥 Rücknahme buchen';
  };
  const drawCart = () => {
    const box = el.querySelector('#cart');
    box.innerHTML = cart.length ? cart.map((c, i) => `<div class="flex items-center justify-between gap-2 rounded-xl border bg-white p-2.5 text-sm"><span><b>${esc(c.name)}</b> <span class="font-mono text-xs text-slate-400">${esc(c.id)}</span>${c.borrower ? `<span class="block text-xs text-slate-500">von ${esc(c.borrower)} · Frist ${fmtDateTime(c.rental.end_at)}</span>` : ''}</span><button data-del="${i}" class="text-slate-400 hover:text-red-600">✕</button></div>`).join('')
      : '<p class="rounded-xl bg-slate-50 p-3 text-center text-sm italic text-slate-400">Noch nichts gescannt.</p>';
    box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { cart.splice(Number(b.dataset.del), 1); drawCart(); }));
    el.querySelector('#mGo').disabled = !cart.length;
  };
  el.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { if (mode !== b.dataset.mode) { mode = b.dataset.mode; cart = []; drawMode(); drawCart(); } }));
  drawMode(); drawCart();

  // Verarbeitet einen Code und liefert eine Rückmeldung für die Scan-Anzeige
  async function addCode(raw) {
    let code = String(raw || '').trim(); if (!code) return '';
    try { const u = new URL(code); if (u.searchParams.get('item')) code = u.searchParams.get('item'); } catch { /* kein URL */ }
    if (code.startsWith('USER:')) {
      const id = code.slice(5);
      if (!people.some((p) => p.id === id)) return '⚠️ Person unbekannt';
      who.value = id; loadRentals();
      return `👤 Ausleiher: ${nameOf(id)}`;
    }
    const id = code.startsWith('ITEM:') ? code.slice(5) : code;
    if (cart.some((c) => c.id === id)) return `ℹ️ ${id} ist schon in der Liste`;
    const item = unwrap(await supabase.from('items').select('id, name, room_id, item_type, status').eq('id', id).maybeSingle());
    if (!item) return `❌ Unbekannter Code: ${id}`;
    if (mode === 'out') {
      if (item.item_type === 'consumable') return `⚠️ ${item.name}: Verbrauchsmaterial – im Katalog entnehmen`;
      if (item.status !== 'active') return `❌ ${item.name}: ${item.status === 'maintenance' ? 'defekt / in Wartung' : 'in Inventur'}`;
      const busyRows = unwrap(await supabase.from('rental_calendar').select('end_at').eq('item_id', id).eq('status', 'active').lte('start_at', new Date().toISOString()));
      if (busyRows.length) return `❌ ${item.name}: ausgeliehen bis ${fmtDateTime(busyRows[0].end_at)}`;
      cart.push({ id, name: item.name }); drawCart();
      return `✅ ${item.name} hinzugefügt`;
    }
    const rs = unwrap(await supabase.from('rentals').select('id, borrower_id, start_at, end_at').eq('item_id', id).eq('status', 'active').order('start_at'));
    const cur = rs.find((r) => new Date(r.start_at) <= new Date()) || rs[0];
    if (!cur) return `⚠️ ${item.name} ist nicht ausgeliehen (oder nicht in deinem Zuständigkeitsbereich)`;
    cart.push({ id, name: item.name, rental: cur, borrower: nameOf(cur.borrower_id) }); drawCart();
    return `✅ ${item.name} (von ${nameOf(cur.borrower_id)}) hinzugefügt`;
  }
  el.querySelector('#camScan').onclick = () => openScanner(addCode, { continuous: true, title: mode === 'out' ? '📤 Ausgabe scannen' : '📥 Rücknahme scannen' });
  el.querySelector('#codeForm').onsubmit = async (e) => {
    e.preventDefault(); const inp = el.querySelector('#codeIn'); const v = inp.value; inp.value = '';
    try { const msg = await addCode(v); if (msg) toast(msg, msg.startsWith('✅') || msg.startsWith('👤') ? 'success' : msg.startsWith('ℹ️') ? 'info' : 'error'); } catch (err) { toast(err.message, 'error'); }
    inp.focus();
  };
  el.querySelector('#mClear').onclick = () => { cart = []; drawCart(); };
  el.querySelector('#mGo').onclick = (e) => busy(e.target, async () => {
    if (!cart.length) return;
    const prot = el.querySelector('#mProt').checked;
    if (mode === 'out') {
      const borrower = who.value; if (!borrower) throw new Error('Bitte oben eine Person (Ausleiher) wählen.');
      const s = new Date(el.querySelector('#mStart').value); const en = new Date(el.querySelector('#mEnd').value);
      if (!(en > s)) throw new Error('Die Rückgabe muss nach dem Beginn liegen.');
      const project = el.querySelector('#mProject').value; const done = []; const failed = [];
      for (const c of cart) {
        try { unwrap(await supabase.rpc('rent_item', { p_item_id: c.id, p_start: s.toISOString(), p_end: en.toISOString(), p_project: project, p_borrower: borrower })); done.push(c); }
        catch (err) { failed.push(`${c.name}: ${err.message}`); }
      }
      cart = cart.filter((c) => !done.includes(c)); drawCart();
      if (done.length) toast(`${done.length} Objekt(e) ausgegeben`, 'success');
      if (failed.length) failList(failed);
      if (done.length && prot) printProtocol({ title: 'Ausgabe-Protokoll', borrower: nameOf(borrower), by: null, rows: done.map((c) => ({ id: c.id, name: c.name, end: en.toISOString() })), note: project ? `Projekt: ${project}` : '' });
      loadRentals();
    } else {
      const by = el.querySelector('#mBy').value || null; const note = el.querySelector('#mNote').value;
      const n = unwrap(await supabase.rpc('return_rentals', { p_rental_ids: cart.map((c) => c.rental.id), p_returned_by: by, p_note: note }));
      toast(`${n} Objekt(e) zurückgenommen`, 'success');
      const rows = cart.map((c) => ({ id: c.id, name: c.name, end: c.rental.end_at, borrower: c.borrower }));
      cart = []; drawCart();
      if (prot) printProtocol({ title: 'Rückgabe-Protokoll', borrower: [...new Set(rows.map((r) => r.borrower))].join(', '), by: by ? nameOf(by) : null, rows, note });
      loadRentals();
    }
  });

  // ================= Leihen einer Person =================
  let rows = [];
  async function loadRentals() {
    const box = el.querySelector('#rentals');
    if (!who.value) { box.innerHTML = ''; return; }
    try {
      rows = unwrap(await supabase.from('rentals').select('id, item_id, start_at, end_at, project, items(name, room_id)').eq('borrower_id', who.value).eq('status', 'active').order('end_at'));
      box.innerHTML = rows.length ? '<label class="flex items-center gap-2 text-xs font-bold text-brand-600"><input type="checkbox" id="all" checked> Alle auswählen</label>' + rows.map((r) => {
        const late = new Date(r.end_at) < new Date();
        return `<label class="flex items-center gap-3 rounded-xl border p-2.5 ${late ? 'border-red-300 bg-red-50' : 'bg-white'}"><input type="checkbox" class="rc" value="${esc(r.id)}" checked>
          <span class="text-sm"><b>${esc(r.items?.name)}</b> <span class="font-mono text-xs text-slate-400">${esc(r.item_id)}</span>${late ? ' <span class="badge bg-red-600 text-white">Überfällig</span>' : ''}<br><span class="text-xs text-slate-500">Frist ${fmtDateTime(r.end_at)}${r.project ? ' · ' + esc(r.project) : ''}</span></span></label>`;
      }).join('') : '<p class="rounded-xl bg-slate-50 p-4 text-center text-sm italic text-slate-400">Keine aktiven Ausleihen (in deinen Räumen).</p>';
      box.querySelector('#all')?.addEventListener('change', (e) => box.querySelectorAll('.rc').forEach((c) => (c.checked = e.target.checked)));
    } catch (e) { toast(e.message, 'error'); }
  }
  who.onchange = loadRentals;
  el.querySelector('#q').oninput = (e) => { fill(e.target.value); loadRentals(); };
  el.querySelector('#scanUser').onclick = () => openScanner(routeScan);
  el.querySelector('#go').onclick = (e) => busy(e.target, async () => {
    const ids = [...el.querySelectorAll('.rc:checked')].map((c) => c.value);
    if (!ids.length) throw new Error('Bitte mindestens ein Objekt auswählen.');
    const by = el.querySelector('#by').value || who.value; const note = el.querySelector('#note').value;
    const picked = rows.filter((r) => ids.includes(r.id));
    const n = unwrap(await supabase.rpc('return_rentals', { p_rental_ids: ids, p_returned_by: by, p_note: note }));
    toast(`${n} Objekt(e) zurückgenommen`, 'success');
    if (el.querySelector('#prot').checked) printProtocol({ title: 'Rückgabe-Protokoll', borrower: nameOf(who.value), by: nameOf(by), rows: picked.map((r) => ({ id: r.item_id, name: r.items?.name, end: r.end_at })), note });
    loadRentals();
  });
  loadRentals();
}

function failList(failed) {
  openModal(`<h3 class="mb-2 text-lg font-bold text-red-600">Nicht alle Objekte gebucht</h3><ul class="mb-3 space-y-1 text-sm">${failed.map((f) => `<li class="rounded-xl bg-red-50 p-2 text-red-700">${esc(f)}</li>`).join('')}</ul><p class="mb-3 text-xs text-slate-500">Diese Objekte bleiben in der Liste.</p><button data-close class="btn-primary w-full">OK</button>`);
}

function printProtocol({ title, borrower, by, rows, note }) {
  const w = window.open('', '_blank');
  if (!w) return toast('Pop-up blockiert – Protokoll konnte nicht geöffnet werden.', 'error');
  const multi = rows.some((r) => r.borrower);
  w.document.write(`<html><head><title>${esc(title)}</title><style>body{font-family:sans-serif;padding:24px;color:#0f172a}h1{margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border:1px solid #cbd5e1;padding:6px;text-align:left;font-size:13px}.s{display:flex;gap:40px;margin-top:70px}.s div{flex:1;border-top:1px solid #64748b;padding-top:6px;font-size:12px;text-align:center}</style></head><body>
  <h1>${esc(title)}</h1><p>Lagerverwaltung Pro · ${fmtDate(new Date().toISOString())} · ID PRT-${Date.now().toString().slice(-6)}</p>
  <p><b>Ausleiher:</b> ${esc(borrower)}${by ? `<br><b>Abgegeben durch:</b> ${esc(by)}` : ''}<br><b>Bearbeitet von:</b> ${esc(state.profile.full_name || state.profile.username)}</p>
  <table><tr><th>ID</th><th>Bezeichnung</th>${multi ? '<th>Ausleiher</th>' : ''}<th>Frist</th></tr>${rows.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td>${multi ? `<td>${esc(r.borrower || '')}</td>` : ''}<td>${fmtDateTime(r.end)}</td></tr>`).join('')}</table>
  ${note ? `<p><b>Vermerk:</b> ${esc(note)}</p>` : ''}
  <div class="s"><div>Unterschrift Ausleiher / Abgebender</div><div>Unterschrift Lagerwart</div></div><script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}
