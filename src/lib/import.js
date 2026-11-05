// Einlesen von .xlsx / .csv, Spaltenzuordnung und Umwandlung in Artikel-Datensätze
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-zäöüß0-9]/g, '');

export const FIELDS = [
  { key: 'name', label: 'Bezeichnung', required: true, aliases: ['name', 'bezeichnung', 'artikel', 'objekt', 'titel', 'gerät', 'produkt'] },
  { key: 'room', label: 'Raum', aliases: ['raum', 'lagerraum', 'oberkategorie', 'bereich'] },
  { key: 'category', label: 'Kategorie', aliases: ['kategorie', 'unterkategorie', 'gruppe'] },
  { key: 'type', label: 'Typ', aliases: ['typ', 'artikeltyp', 'art'] },
  { key: 'stock', label: 'Bestand', aliases: ['bestand', 'menge', 'anzahl', 'stück', 'stueck'] },
  { key: 'min', label: 'Mindestbestand', aliases: ['mindestbestand', 'minbestand', 'minimum'] },
  { key: 'shelf', label: 'Regal', aliases: ['regal'] },
  { key: 'compartment', label: 'Fach', aliases: ['fach', 'fachnummer'] },
  { key: 'accessories', label: 'Zubehör', aliases: ['zubehör', 'zubehoer', 'inhalt', 'kofferinhalt', 'kofferinhalte'] },
  { key: 'perm', label: 'Berechtigung', aliases: ['berechtigung', 'erforderlicheberechtigung', 'schein'] },
  { key: 'id', label: 'ID (optional)', aliases: ['id', 'sku', 'artikelnr', 'artikelnummer', 'inventarnummer', 'nr'] },
];

export const colLetter = (i) => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

export function downloadTemplate() {
  const rows = [FIELDS.map((f) => f.label.replace(' (optional)', '')), ['Beispiel: Sony Alpha 7 IV', 'Technik', 'Kamera', 'Standard', '1', '', 'Regal A', 'Fach 2', 'Akku, Ladekabel, Tasche', 'Kamera-Schein', '']];
  const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'artikel-vorlage.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const cellText = (c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '').trim());

// Gibt { grid: string[][], sheets: string[] } zurück
export async function readGrid(file, sheet = null) {
  const ext = file.name.split('.').pop().toLowerCase();
  let raw; let sheets = [];
  if (ext === 'xlsx') {
    const mod = await import('read-excel-file');
    try { sheets = (await mod.readSheetNames(file)) || []; } catch { sheets = []; }
    raw = await mod.default(file, sheet || sheets.length ? { sheet: sheet || sheets[0] } : undefined);
  } else if (['csv', 'txt'].includes(ext)) {
    raw = parseCsv(await file.text());
  } else {
    throw new Error('Bitte eine .xlsx- oder .csv-Datei wählen (alte .xls-Dateien vorher in Excel als .xlsx speichern).');
  }
  const grid = raw.map((r) => r.map(cellText)).filter((r) => r.some((c) => c !== ''));
  if (!grid.length) throw new Error('Die Datei enthält keine Daten.');
  const width = Math.max(...grid.map((r) => r.length));
  return { grid: grid.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')), sheets };
}

// Schlägt pro Spalte ein App-Feld anhand der Überschrift vor ('' = nicht importieren)
export function guessMapping(headerRow) {
  const used = new Set();
  return headerRow.map((h) => {
    const f = FIELDS.find((x) => !used.has(x.key) && x.aliases.map(norm).includes(norm(h)));
    if (f) { used.add(f.key); return f.key; }
    return '';
  });
}

// rows: [{ line, cells }]  ->  [{ line, ok, error, item }]
export function buildItems(rows, mapping, { rooms, defaultRoom, canManage }) {
  const roomOf = (txt) => { const t = norm(txt); return rooms.find((r) => norm(r.id) === t || norm(r.name) === t) || null; };
  const num = (v, d) => { const n = parseInt(String(v).replace(',', '.'), 10); return Number.isFinite(n) && n >= 0 ? n : d; };
  return rows.map(({ line, cells }) => {
    const v = {};
    mapping.forEach((f, i) => { if (f) v[f] = cells[i] ?? ''; });
    if (!v.name) return { line, ok: false, error: 'Bezeichnung fehlt' };
    let room = v.room ? roomOf(v.room) : rooms.find((r) => r.id === defaultRoom);
    if (!room) return { line, ok: false, error: v.room ? `Raum „${v.room}" unbekannt` : 'Kein Raum gewählt' };
    if (!canManage(room.id)) return { line, ok: false, error: `Keine Berechtigung für Raum „${room.name}"` };
    const t = norm(v.type);
    return { line, ok: true, item: {
      id: v.id || null, name: v.name, room_id: room.id, category: v.category || null,
      item_type: /kit|koffer/.test(t) ? 'kit' : /verbrauch|consum/.test(t) ? 'consumable' : 'standard',
      stock_quantity: num(v.stock, 1), min_stock: num(v.min, 0), shelf: v.shelf || null, compartment: v.compartment || null,
      accessories: (v.accessories || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean), required_permission: v.perm || null,
    } };
  });
}
