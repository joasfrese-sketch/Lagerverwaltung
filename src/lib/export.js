import { supabase, unwrap } from './supabase.js';

const download = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const stamp = () => new Date().toISOString().slice(0, 10);

// columns: [{ key, label }], rows: Objekte
export async function exportRows(baseName, columns, rows, format) {
  const name = `${baseName}-${stamp()}`;
  if (format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '\ufeff' + [columns.map((c) => esc(c.label)).join(';'), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(';'))].join('\r\n');
    return download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
  }
  const mod = await import('exceljs/dist/exceljs.min.js');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Daten');
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(40, Math.max(12, c.label.length + 4)) }));
  rows.forEach((r) => ws.addRow(Object.fromEntries(columns.map((c) => [c.key, r[c.key] ?? '']))));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
}

// Mehrere Tabellenblätter in einer Excel-Datei: sheets = [{ name, columns, rows }]
export async function exportWorkbook(baseName, sheets) {
  const mod = await import('exceljs/dist/exceljs.min.js');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(40, Math.max(12, c.label.length + 4)) }));
    s.rows.forEach((r) => ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, r[c.key] ?? '']))));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${baseName}-${stamp()}.xlsx`);
}

// Holt alle Zeilen seitenweise (PostgREST liefert max. 1000 pro Anfrage)
export async function fetchAll(buildQuery, max = 20000) {
  let out = [];
  for (let from = 0; from < max; from += 1000) {
    const part = unwrap(await buildQuery().range(from, from + 999));
    out = out.concat(part);
    if (part.length < 1000) break;
  }
  return out;
}
