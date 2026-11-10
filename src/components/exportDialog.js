import { esc, openModal, busy, toast } from '../lib/ui.js';
import { exportRows } from '../lib/export.js';
import { icon } from '../lib/icons.js';

// Dialog "Exportieren": load() liefert { columns, rows }
export function openExport({ title, filename, load }) {
  const { el } = openModal(`
    <h3 class="mb-1 text-lg font-bold">${icon('download', 'mr-1 inline h-5 w-5')}${esc(title)}</h3>
    <p class="mb-4 text-sm text-slate-500">Format wählen – die Datei wird direkt heruntergeladen.</p>
    <div class="grid grid-cols-2 gap-3"><button data-f="xlsx" class="btn-primary">Excel (.xlsx)</button><button data-f="csv" class="btn-ghost">CSV</button></div>
    <button data-close class="btn-ghost mt-3 w-full">Abbrechen</button>`);
  el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => busy(b, async () => {
    const { columns, rows } = await load();
    if (!rows.length) return toast('Keine Daten zum Exportieren.', 'error');
    await exportRows(filename, columns, rows, b.dataset.f);
    toast(`${rows.length} Zeilen exportiert`, 'success');
  })));
}
