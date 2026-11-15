import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, busy, openModal, fmtDateTime } from '../lib/ui.js';
import { displayName } from '../lib/format.js';
import { state, isManager, canManageRoom } from '../state.js';
import { fetchAll, exportRows } from '../lib/export.js';
import { openScanner } from '../components/scanner.js';
import { diffInventory, codeToItemId, diffRows } from '../lib/inventory.js';

// Laufende Zählung wird im Gerät zwischengespeichert (schwaches Netz im Lager, versehentliches Neuladen)
const KEY = (room) => `inv_${room}`;
const loadLocal = (room) => { try { return JSON.parse(localStorage.getItem(KEY(room)) || '[]'); } catch { return []; } };
const saveLocal = (room, codes) => { try { localStorage.setItem(KEY(room), JSON.stringify(codes)); } catch { /* egal */ } };
const clearLocal = (room) => { try { localStorage.removeItem(KEY(room)); } catch { /* egal */ } };

let S = null; // { room, items, scanned: Map, tab }

export async function render(el) {
  if (!isManager()) { el.innerHTML = '<div class="card text-center text-slate-500">Nur für Raum-Manager und Administratoren.</div>'; return; }
  const rooms = state.rooms.filter((r) => canManageRoom(r.id));
  el.innerHTML = `
    <div class="mb-4 flex flex-wrap items-center gap-2"><h1 class="mr-auto text-2xl font-bold">📋 Inventur</h1></div>
    <div class="card mb-4 space-y-3">
      <p class="text-sm text-slate-500">Raum wählen, alle Artikel scannen und am Ende Soll und Ist vergleichen. Der Zwischenstand bleibt auf diesem Gerät erhalten, auch wenn die Seite neu geladen wird.</p>
      <div class="flex flex-wrap gap-2"><select id="room" class="input !w-auto">${rooms.map((r) => `<option value="${esc(r.id)}" ${S?.room === r.id ? 'selected' : ''}>${esc(r.icon)} ${esc(r.name)}${loadLocal(r.id).length ? ` (${loadLocal(r.id).length} gezählt – fortsetzen)` : ''}</option>`).join('')}</select>
        <button id="start" class="btn-primary">${S ? 'Raum wechseln' : 'Inventur starten'}</button></div>
    </div>
    <div id="work"></div>
    <section class="card mt-4"><h2 class="mb-2 font-bold">Bisherige Inventuren</h2><div id="hist" class="space-y-2 text-sm"><p class="text-slate-400">Lade…</p></div></section>`;
  el.querySelector('#start').onclick = (e) => busy(e.target, () => start(el, el.querySelector('#room').value), { offlineOk: true });
  if (S) drawWork(el);
  loadHistory(el);
}

async function start(el, room) {
  const items = await fetchAll(() => supabase.from('catalog_items').select('id, name, room_id, status, item_type, shelf, compartment, rented_now').eq('room_id', room).order('name'));
  S = { room, items, scanned: new Map(), tab: 'missing' };
  // gespeicherten Zwischenstand wiederherstellen
  const saved = loadLocal(room);
  if (saved.length) {
    const byId = new Map(items.map((i) => [i.id, i]));
    const other = saved.filter((c) => !byId.has(c));
    let known = [];
    try { if (other.length) known = unwrap(await supabase.from('items').select('id, name, room_id').in('id', other.slice(0, 500))); } catch { /* offline */ }
    saved.forEach((c) => S.scanned.set(c, byId.get(c) || known.find((k) => k.id === c) || null));
    toast(`${saved.length} bereits gezählte Codes wiederhergestellt`, 'info');
  }
  drawWork(el);
}

async function addCode(el, raw) {
  const id = codeToItemId(raw);
  if (!id) return '⚠️ Kein Artikel-Code';
  if (S.scanned.has(id)) return `ℹ️ ${S.scanned.get(id)?.name || id} schon gezählt`;
  let item = S.items.find((i) => i.id === id) || null;
  let offline = false;
  if (!item) {
    try { item = unwrap(await supabase.from('items').select('id, name, room_id').eq('id', id).maybeSingle()); }
    catch { offline = true; item = null; } // ohne Netz trotzdem zählen – geprüft wird beim Abschließen
  }
  S.scanned.set(id, item);
  saveLocal(S.room, [...S.scanned.keys()]);
  drawWork(el);
  if (!item) return offline ? `📶 ${id} gespeichert (offline – wird beim Abschließen geprüft)` : `❓ Unbekannter Code: ${id}`;
  if (item.room_id !== S.room) return `⚠️ ${item.name}: gehört in Raum „${item.room_id}"`;
  return `✅ ${item.name}`;
}

function drawWork(el) {
  const box = el.querySelector('#work'); if (!box || !S) return;
  const room = state.rooms.find((r) => r.id === S.room);
  const d = diffInventory(S.items, S.scanned, S.room);
  const pct = d.expected ? Math.round((d.found.length / d.expected) * 100) : 100;
  const tabs = [['missing', `Fehlend (${d.missing.length})`], ['found', `Gefunden (${d.found.length})`], ['foreign', `Fremd/unbekannt (${d.unexpected.length + d.unknown.length})`], ['rented', `Ausgeliehen (${d.rented.length})`]];
  const row = (i, extra = '') => `<div class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2 text-sm"><span class="min-w-0"><b class="block truncate">${esc(i.name)}</b><span class="font-mono text-[13px] text-slate-400">${esc(i.id)}${i.shelf || i.compartment ? ' · ' + esc([i.shelf, i.compartment].filter(Boolean).join(' · ')) : ''}</span></span>${extra}</div>`;
  const lists = {
    missing: d.missing.map((i) => row(i, `<button data-mark="${esc(i.id)}" class="btn-ghost shrink-0 !px-2.5 !py-1 !text-xs">✓ Gefunden</button>`)),
    found: d.found.map((i) => row(i, `<button data-unmark="${esc(i.id)}" class="shrink-0 text-xs text-slate-400 hover:text-red-600">rückgängig</button>`)),
    foreign: [...d.unexpected.map((i) => row(i, `<span class="badge shrink-0 bg-amber-100 text-amber-800">gehört in ${esc(i.room_id)}</span>`)), ...d.unknown.map((c) => row({ id: c, name: 'Unbekannter Code' }, `<button data-unmark="${esc(c)}" class="shrink-0 text-xs text-slate-400 hover:text-red-600">entfernen</button>`))],
    rented: d.rented.map((i) => row(i, '<span class="badge shrink-0 bg-blue-100 text-blue-700">ausgeliehen</span>')),
  };
  const cur = lists[S.tab] || [];
  box.innerHTML = `
    <div class="card space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="font-bold">${esc(room?.icon || '')} ${esc(room?.name || S.room)}</h2><span class="text-sm font-semibold">${d.found.length} / ${d.expected} gezählt</span></div>
      <div class="h-2.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full bg-brand-600 transition-all" style="width:${pct}%"></div></div>
      <div class="flex flex-wrap gap-2"><button id="cam" class="btn-primary">📷 Kamera-Scan</button>
        <form id="codeForm" class="flex flex-1 gap-2"><input id="codeIn" class="input" placeholder="Code scannen/eintippen + Enter (auch USB-Scanner)" autocomplete="off"><button class="btn-ghost">OK</button></form></div>
      <div class="flex flex-wrap gap-1.5">${tabs.map(([k, l]) => `<button data-tab="${k}" class="rounded-full px-3 py-1 text-xs font-semibold ${S.tab === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}">${l}</button>`).join('')}</div>
      <div class="max-h-[50vh] space-y-1.5 overflow-y-auto">${cur.length ? cur.join('') : '<p class="py-4 text-center text-sm italic text-slate-400">Keine Einträge.</p>'}</div>
      <div class="space-y-2 rounded-xl bg-slate-50 p-3">
        <input id="note" class="input" placeholder="Notiz zur Inventur (optional)">
        <label class="flex items-start gap-2 text-sm"><input type="checkbox" id="mark" class="mt-0.5"> <span>Fehlende Artikel auf <b>„In Inventur"</b> setzen (bis zur Klärung nicht ausleihbar)</span></label>
        <div class="flex flex-wrap justify-end gap-2"><button id="discard" class="btn-ghost">Verwerfen</button><button id="finish" class="btn-primary">Inventur abschließen</button></div>
      </div>
    </div>`;
  box.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; drawWork(el); }));
  box.querySelectorAll('[data-mark]').forEach((b) => (b.onclick = () => { S.scanned.set(b.dataset.mark, S.items.find((i) => i.id === b.dataset.mark)); saveLocal(S.room, [...S.scanned.keys()]); drawWork(el); }));
  box.querySelectorAll('[data-unmark]').forEach((b) => (b.onclick = () => { S.scanned.delete(b.dataset.unmark); saveLocal(S.room, [...S.scanned.keys()]); drawWork(el); }));
  box.querySelector('#cam').onclick = () => openScanner((t) => addCode(el, t), { continuous: true, title: '📋 Inventur scannen' });
  box.querySelector('#codeForm').onsubmit = async (e) => {
    e.preventDefault(); const inp = box.querySelector('#codeIn'); const v = inp.value; inp.value = '';
    try { const msg = await addCode(el, v); toast(msg, msg.startsWith('✅') ? 'success' : msg.startsWith('ℹ️') ? 'info' : 'error'); } catch (err) { toast(err.message, 'error'); }
    el.querySelector('#codeIn')?.focus();
  };
  box.querySelector('#discard').onclick = () => { if (confirm('Zählung verwerfen? Alle gescannten Codes dieses Raums gehen verloren.')) { clearLocal(S.room); S = null; render(el); } };
  box.querySelector('#finish').onclick = (e) => {
    if (d.missing.length && !confirm(`${d.missing.length} Artikel wurden nicht gefunden. Inventur trotzdem abschließen?`)) return;
    busy(e.target, async () => {
      const res = unwrap(await supabase.rpc('save_inventory', { p_room: S.room, p_scanned: [...S.scanned.keys()], p_note: box.querySelector('#note').value, p_mark_missing: box.querySelector('#mark').checked }));
      const room = S.room; clearLocal(room); S = null;
      showResult(res, room, new Date().toISOString());
      render(el);
    });
  };
}

function showResult(res, roomId, when) {
  const rows = diffRows(res, roomId);
  const ok = !res.missing.length && !res.unexpected.length && !res.unknown.length;
  const { el } = openModal(`
    <h3 class="mb-1 text-lg font-bold">Inventur ${esc(roomId)} – ${fmtDateTime(when)}</h3>
    <div class="mb-3 grid grid-cols-4 gap-2 text-center">
      <div class="rounded-xl bg-slate-50 p-2"><div class="text-xl font-black">${res.expected}</div><div class="text-[13px] text-slate-500">Soll</div></div>
      <div class="rounded-xl bg-emerald-50 p-2"><div class="text-xl font-black text-emerald-700">${res.found}</div><div class="text-[13px] text-slate-500">Ist</div></div>
      <div class="rounded-xl bg-red-50 p-2"><div class="text-xl font-black text-red-600">${res.missing.length}</div><div class="text-[13px] text-slate-500">Fehlt</div></div>
      <div class="rounded-xl bg-amber-50 p-2"><div class="text-xl font-black text-amber-700">${res.unexpected.length + res.unknown.length}</div><div class="text-[13px] text-slate-500">Fremd</div></div></div>
    ${ok ? '<p class="mb-3 rounded-xl bg-emerald-50 p-3 text-center text-sm font-semibold text-emerald-700">✅ Keine Differenzen – Bestand stimmt.</p>'
      : `<div class="mb-3 max-h-64 overflow-y-auto rounded-xl border"><table class="w-full text-left text-xs"><thead class="bg-slate-50 text-slate-500"><tr><th class="p-2">Ergebnis</th><th class="p-2">ID</th><th class="p-2">Bezeichnung</th><th class="p-2">Raum</th></tr></thead><tbody>${rows.map((r) => `<tr class="border-t"><td class="p-2 font-semibold">${esc(r.ergebnis)}</td><td class="p-2 font-mono">${esc(r.id)}</td><td class="p-2">${esc(r.name)}</td><td class="p-2">${esc(r.raum)}</td></tr>`).join('')}</tbody></table></div>`}
    <div class="grid grid-cols-3 gap-2"><button data-f="xlsx" class="btn-primary" ${rows.length ? '' : 'disabled'}>Excel</button><button data-f="csv" class="btn-ghost" ${rows.length ? '' : 'disabled'}>CSV</button><button id="print" class="btn-ghost">Drucken</button></div>
    <button data-close class="btn-ghost mt-2 w-full">Schließen</button>`, { wide: true });
  const cols = [{ key: 'ergebnis', label: 'Ergebnis' }, { key: 'id', label: 'Artikel-ID' }, { key: 'name', label: 'Bezeichnung' }, { key: 'raum', label: 'Raum' }];
  el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => busy(b, () => exportRows(`inventur-${roomId}`, cols, rows, b.dataset.f))));
  el.querySelector('#print').onclick = () => {
    const w = window.open('', '_blank'); if (!w) return toast('Pop-up blockiert.', 'error');
    w.document.write(`<html><head><title>Inventur ${esc(roomId)}</title><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #cbd5e1;padding:5px;font-size:12px;text-align:left}</style></head><body>
      <h1>Inventur-Differenzliste: ${esc(roomId)}</h1><p>${fmtDateTime(when)} · Soll ${res.expected} · Ist ${res.found} · Fehlt ${res.missing.length} · Fremd/unbekannt ${res.unexpected.length + res.unknown.length}</p>
      <table><tr><th>Ergebnis</th><th>ID</th><th>Bezeichnung</th><th>Raum</th></tr>${rows.map((r) => `<tr><td>${esc(r.ergebnis)}</td><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.raum)}</td></tr>`).join('')}</table>
      <p style="margin-top:60px;border-top:1px solid #64748b;width:260px;padding-top:4px;font-size:12px">Unterschrift</p><script>onload=()=>print()<\/script></body></html>`);
    w.document.close();
  };
}

async function loadHistory(el) {
  const box = el.querySelector('#hist');
  try {
    const rows = unwrap(await supabase.from('inventory_counts').select('*').order('created_at', { ascending: false }).limit(20));
    const ids = [...new Set(rows.map((r) => r.counted_by).filter(Boolean))];
    const people = ids.length ? unwrap(await supabase.from('public_profiles').select('id, full_name, username').in('id', ids)) : [];
    const name = Object.fromEntries(people.map((p) => [p.id, displayName(p)]));
    box.innerHTML = rows.length ? rows.map((r, i) => `<button data-h="${i}" class="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-2.5 text-left hover:bg-slate-100">
      <span><b>${esc(r.room_id)}</b> <span class="text-xs text-slate-500">${fmtDateTime(r.created_at)} · ${esc(name[r.counted_by] || '?')}${r.note ? ' · ' + esc(r.note) : ''}</span></span>
      <span class="flex gap-1 text-xs"><span class="badge bg-emerald-100 text-emerald-800">${r.found}/${r.expected}</span>${r.missing.length ? `<span class="badge bg-red-100 text-red-700">${r.missing.length} fehlen</span>` : ''}${r.unexpected.length + r.unknown.length ? `<span class="badge bg-amber-100 text-amber-800">${r.unexpected.length + r.unknown.length} fremd</span>` : ''}</span></button>`).join('')
      : '<p class="italic text-slate-400">Noch keine Inventur gespeichert.</p>';
    box.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => { const r = rows[b.dataset.h]; showResult(r, r.room_id, r.created_at); }));
  } catch (e) { box.innerHTML = `<p class="text-sm text-red-600">${esc(e.message)}</p><p class="text-xs text-slate-500">Migration 007 eingespielt?</p>`; }
}
