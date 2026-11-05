import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';
import { state, canManageRoom } from '../state.js';
import { FIELDS, colLetter, readGrid, guessMapping, buildItems, downloadTemplate } from '../lib/import.js';

// Excel-/CSV-Import mit Vorschau, Spaltenzuordnung (tauschen / entfernen) und Zeilenauswahl
export function openImportWizard({ defaultRoom, done }) {
  const manageable = state.rooms.filter((r) => canManageRoom(r.id));
  if (!manageable.length) return toast('Keine Berechtigung zum Anlegen von Artikeln.', 'error');
  const S = { file: null, grid: [], sheets: [], sheet: null, hasHeader: true, mapping: [], room: manageable.some((r) => r.id === defaultRoom) ? defaultRoom : manageable[0].id, excluded: new Set(), existing: new Set(), results: [] };

  const { el, close } = openModal(`
    <div class="mb-3 flex items-center justify-between"><h3 class="text-lg font-bold">📊 Excel / CSV importieren</h3><button data-close class="text-slate-400">✕</button></div>
    <div id="up" class="rounded-2xl border-2 border-dashed border-slate-300 p-5 text-center">
      <p class="mb-2 text-sm text-slate-600">Datei auswählen oder hierher ziehen (<b>.xlsx</b> oder <b>.csv</b>)</p>
      <input id="file" type="file" accept=".xlsx,.csv,.txt" class="text-sm">
      <div class="mt-2"><button id="tpl" type="button" class="text-xs font-semibold text-brand-600">⬇️ Vorlage herunterladen</button></div></div>
    <div id="work" class="mt-4 hidden space-y-4"></div>`, { wide: true });
  el.firstElementChild.classList.add('sm:max-w-4xl');
  el.querySelector('#tpl').onclick = downloadTemplate;

  const load = async (file, sheet = null) => {
    try {
      const { grid, sheets } = await readGrid(file, sheet);
      S.file = file; S.grid = grid; S.sheets = sheets; S.sheet = sheet || sheets[0] || null; S.excluded = new Set();
      S.mapping = guessMapping(S.hasHeader ? grid[0] : grid[0].map(() => ''));
      await refresh();
    } catch (e) { toast(e.message, 'error'); }
  };
  el.querySelector('#file').onchange = (e) => e.target.files[0] && load(e.target.files[0]);
  const up = el.querySelector('#up');
  up.ondragover = (e) => { e.preventDefault(); up.classList.add('border-brand-500'); };
  up.ondragleave = () => up.classList.remove('border-brand-500');
  up.ondrop = (e) => { e.preventDefault(); up.classList.remove('border-brand-500'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };

  const dataRows = () => S.grid.slice(S.hasHeader ? 1 : 0).map((cells, i) => ({ line: i + (S.hasHeader ? 2 : 1), cells }));
  const header = (i) => (S.hasHeader && S.grid[0][i]) || `Spalte ${colLetter(i)}`;
  const fieldLabel = (k) => FIELDS.find((f) => f.key === k)?.label || '';

  async function refresh() {
    S.results = buildItems(dataRows(), S.mapping, { rooms: state.rooms, defaultRoom: S.room, canManage: canManageRoom });
    const ids = S.results.filter((r) => r.ok && r.item.id).map((r) => r.item.id);
    S.existing = new Set(ids.length ? unwrap(await supabase.from('items').select('id').in('id', ids.slice(0, 500))).map((x) => x.id) : []);
    draw();
  }

  function setMap(i, f) {
    const old = S.mapping[i];
    if (f) { const j = S.mapping.findIndex((m, k) => m === f && k !== i); if (j >= 0) S.mapping[j] = old || ''; } // belegtes Feld -> Spalten tauschen
    S.mapping[i] = f;
    refresh();
  }

  function draw() {
    const work = el.querySelector('#work'); work.classList.remove('hidden');
    const colsN = S.grid[0].length; const rows = dataRows();
    const hasName = S.mapping.includes('name');
    const ok = S.results.filter((r) => r.ok && !S.excluded.has(r.line));
    const bad = S.results.filter((r) => !r.ok);
    const shown = FIELDS.filter((f) => S.mapping.includes(f.key) || f.key === 'room');

    work.innerHTML = `
      <div class="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
        <span>📄 <b>${esc(S.file.name)}</b> · ${rows.length} Zeilen</span>
        ${S.sheets.length > 1 ? `<label>Blatt <select id="sheet" class="input !inline-block !w-auto !py-1">${S.sheets.map((s) => `<option ${s === S.sheet ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
        <label class="flex items-center gap-1.5"><input type="checkbox" id="hdr" ${S.hasHeader ? 'checked' : ''}> Erste Zeile ist Überschrift</label>
        <label class="flex items-center gap-1.5">Raum, wenn keine Spalte „Raum" zugeordnet / Zelle leer:
          <select id="room" class="input !inline-block !w-auto !py-1">${manageable.map((r) => `<option value="${esc(r.id)}" ${r.id === S.room ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label></div>

      <div><h4 class="mb-1 text-sm font-bold">1. Spalten zuordnen</h4>
        <p class="mb-2 text-xs text-slate-500">Wähle für jede Excel-Spalte das passende App-Feld. Ist ein Feld schon vergeben, werden die beiden Spalten <b>getauscht</b>. Mit ✕ lässt du eine Spalte weg.</p>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          ${Array.from({ length: colsN }, (_, i) => {
            const f = S.mapping[i]; const sample = rows.slice(0, 2).map((r) => r.cells[i]).filter(Boolean).join(' · ');
            return `<div class="rounded-xl border p-2.5 ${f ? '' : 'opacity-60'}"><div class="flex items-start justify-between gap-2"><div class="min-w-0"><div class="truncate text-xs font-bold">${esc(header(i))}</div><div class="truncate text-[11px] text-slate-400">${esc(sample) || '—'}</div></div>
              ${f ? `<button data-rm="${i}" title="Spalte nicht importieren" class="text-slate-400 hover:text-red-600">✕</button>` : ''}</div>
              <select data-map="${i}" class="input mt-1.5 !py-1.5 text-xs"><option value="">— nicht importieren —</option>${FIELDS.map((x) => `<option value="${x.key}" ${f === x.key ? 'selected' : ''}>${esc(x.label)}${x.required ? ' *' : ''}</option>`).join('')}</select></div>`;
          }).join('')}</div>
        ${hasName ? '' : '<p class="mt-2 rounded-xl bg-red-50 p-2 text-xs text-red-700">Bitte eine Spalte dem Feld „Bezeichnung" zuordnen.</p>'}</div>

      <div><h4 class="mb-1 text-sm font-bold">2. Vorschau – so werden die Objekte angelegt</h4>
        <div class="max-h-72 overflow-auto rounded-xl border"><table class="w-full text-left text-xs"><thead class="sticky top-0 bg-slate-50"><tr><th class="p-2"></th><th class="p-2">Zeile</th>${shown.map((f) => `<th class="p-2">${esc(f.label.replace(' (optional)', ''))}</th>`).join('')}<th class="p-2">Status</th></tr></thead><tbody>
          ${S.results.slice(0, 100).map((r) => {
            const ex = S.excluded.has(r.line);
            if (!r.ok) return `<tr class="border-t bg-red-50"><td class="p-2"></td><td class="p-2">${r.line}</td><td class="p-2 text-red-700" colspan="${shown.length + 1}">${esc(r.error)}</td></tr>`;
            const it = r.item; const upd = it.id && S.existing.has(it.id);
            const val = { name: it.name, room: it.room_id, category: it.category, type: it.item_type, stock: it.stock_quantity, min: it.min_stock, shelf: it.shelf, compartment: it.compartment, accessories: it.accessories.join(', '), perm: it.required_permission, id: it.id };
            return `<tr class="border-t ${ex ? 'opacity-40' : ''}"><td class="p-2"><input type="checkbox" data-row="${r.line}" ${ex ? '' : 'checked'}></td><td class="p-2">${r.line}</td>${shown.map((f) => `<td class="p-2 ${f.key === 'name' ? 'font-semibold' : ''}">${esc(val[f.key] ?? '')}</td>`).join('')}
              <td class="p-2"><span class="badge ${upd ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${upd ? 'aktualisiert' : 'neu'}</span></td></tr>`;
          }).join('')}</tbody></table></div>
        ${S.results.length > 100 ? `<p class="mt-1 text-xs text-slate-400">Vorschau zeigt die ersten 100 von ${S.results.length} Zeilen – alle werden importiert.</p>` : ''}
        <p class="mt-1 text-xs text-slate-500">Mit dem Haken links kannst du einzelne Zeilen vom Import ausnehmen.</p></div>

      <div class="flex flex-wrap items-center justify-between gap-2"><span class="text-sm"><b class="text-brand-600">${ok.length}</b> werden importiert${bad.length ? ` · <b class="text-red-600">${bad.length}</b> mit Fehlern (übersprungen)` : ''}</span>
        <div class="flex gap-2"><button data-close class="btn-ghost">Abbrechen</button><button id="go" class="btn-primary" ${!hasName || !ok.length ? 'disabled' : ''}>${ok.length} Artikel importieren</button></div></div>`;

    work.querySelectorAll('[data-map]').forEach((s) => (s.onchange = () => setMap(Number(s.dataset.map), s.value)));
    work.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => setMap(Number(b.dataset.rm), '')));
    work.querySelectorAll('[data-row]').forEach((c) => (c.onchange = () => { const l = Number(c.dataset.row); c.checked ? S.excluded.delete(l) : S.excluded.add(l); draw(); }));
    work.querySelector('#hdr').onchange = (e) => { S.hasHeader = e.target.checked; S.mapping = guessMapping(S.hasHeader ? S.grid[0] : S.grid[0].map(() => '')); S.excluded = new Set(); refresh(); };
    work.querySelector('#room').onchange = (e) => { S.room = e.target.value; refresh(); };
    work.querySelector('#sheet')?.addEventListener('change', (e) => load(S.file, e.target.value));
    work.querySelector('#go').onclick = (e) => busy(e.target, () => runImport(ok.map((r) => r.item), e.target));
  }

  async function runImport(items, btn) {
    const withId = items.filter((i) => i.id); const noId = items.filter((i) => !i.id).map(({ id, ...rest }) => rest);
    let n = 0;
    try {
      for (let i = 0; i < noId.length; i += 100) { unwrap(await supabase.from('items').insert(noId.slice(i, i + 100))); n += Math.min(100, noId.length - i); btn.textContent = `Importiere… ${n}/${items.length}`; }
      for (let i = 0; i < withId.length; i += 100) { unwrap(await supabase.from('items').upsert(withId.slice(i, i + 100), { onConflict: 'id' })); n += Math.min(100, withId.length - i); btn.textContent = `Importiere… ${n}/${items.length}`; }
    } catch (err) { throw new Error(`Import nach ${n} von ${items.length} Artikeln abgebrochen: ${err.message}`); }
    close(); toast(`${n} Artikel importiert`, 'success'); done();
  }
}
