import { supabase, unwrap } from '../lib/supabase.js';
import { esc, openModal, toast, fmtDateTime } from '../lib/ui.js';
import { state, isManager } from '../state.js';
import { rentModal, openRoom } from '../pages/catalog.js';
import { returnModal } from '../pages/me.js';

// Unterstützte Codes: ITEM:<id> | USER:<uuid> | ROOM:<id> | reine Artikel-ID | URL mit ?item=<id>
export async function openScanner(onCode) {
  let scanner = null;
  const stop = async () => { try { if (scanner) { await scanner.stop(); scanner.clear(); } } catch { /* ignore */ } scanner = null; };
  const { el, close } = openModal(`
    <h3 class="mb-2 text-lg font-bold">📷 Code scannen</h3>
    <div id="reader" class="overflow-hidden rounded-xl bg-slate-100"></div>
    <p id="scanHint" class="mt-2 text-xs text-slate-500">Artikel-, Personen- oder Raum-QR vor die Kamera halten.</p>
    <form id="manual" class="mt-3 flex gap-2"><input name="code" class="input" placeholder="oder Code manuell eingeben"><button class="btn-primary">OK</button></form>
    <button data-close class="btn-ghost mt-3 w-full">Schließen</button>`, { onClose: stop });
  const done = async (code) => { await stop(); close(); onCode(code); };
  el.querySelector('#manual').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('code').trim(); if (v) done(v); };
  try {
    const { Html5Qrcode } = await import('html5-qrcode');
    scanner = new Html5Qrcode('reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, (text) => done(text), () => {});
  } catch {
    el.querySelector('#scanHint').textContent = 'Kamera nicht verfügbar oder nicht erlaubt – bitte Code manuell eingeben.';
  }
}

export async function routeScan(raw) {
  let code = String(raw || '').trim();
  try { const u = new URL(code); if (u.searchParams.get('item')) code = 'ITEM:' + u.searchParams.get('item'); } catch { /* kein URL */ }
  try {
    if (code.startsWith('USER:')) {
      if (!isManager()) return toast('Personen-Codes können nur Lagerwarte/Admins verwenden.', 'error');
      location.hash = `#/terminal?user=${encodeURIComponent(code.slice(5))}`;
      window.dispatchEvent(new Event('hashchange'));
      return;
    }
    if (code.startsWith('ROOM:')) { openRoom(code.slice(5)); location.hash = '#/katalog'; window.dispatchEvent(new Event('hashchange')); return; }
    const id = code.startsWith('ITEM:') ? code.slice(5) : code;
    const item = unwrap(await supabase.from('items').select('*').eq('id', id).maybeSingle());
    if (!item) return toast(`Kein Artikel zu „${code}" gefunden.`, 'error');
    // Aktive Ausleihe, die ich sehen darf (eigene bzw. verantwortete Räume)
    const rentals = unwrap(await supabase.from('rentals').select('id, item_id, start_at, end_at, project, items(name, accessories)')
      .eq('item_id', id).eq('status', 'active').order('start_at'));
    const current = rentals.find((r) => new Date(r.start_at) <= new Date());
    if (current) return returnModal(current, () => window.dispatchEvent(new Event('hashchange')));
    if (item.item_type === 'consumable') { openRoom(item.room_id); location.hash = '#/katalog'; window.dispatchEvent(new Event('hashchange')); return toast('Verbrauchsmaterial: im Katalog „Entnehmen" wählen.'); }
    if (item.status !== 'active') return toast(`${item.name}: ${item.status === 'maintenance' ? 'Defekt / in Wartung' : 'in Inventur'}`, 'error');
    const busyRows = unwrap(await supabase.from('rental_calendar').select('end_at').eq('item_id', id).eq('status', 'active').lte('start_at', new Date().toISOString()));
    if (busyRows.length) return toast(`${item.name} ist ausgeliehen bis ${fmtDateTime(busyRows[0].end_at)}.`, 'error');
    rentModal(item, () => window.dispatchEvent(new Event('hashchange')));
  } catch (e) { toast(e.message, 'error'); }
}
