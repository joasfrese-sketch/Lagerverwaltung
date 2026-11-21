// @ts-check
// Geschäftsregeln der Oberfläche an EINEM Ort – reine Funktionen ohne DOM, vollständig testbar.
// Maßgeblich bleibt die Datenbank (sie lehnt unzulässige Buchungen ab); diese Regeln dienen der
// Anzeige und der frühen Rückmeldung, damit Nutzer vor dem Absenden sehen, was möglich ist.

/** @typedef {import('./types.js').CatalogItem} CatalogItem */
/** @typedef {import('./types.js').Booking} Booking */
/** @typedef {import('./types.js').StatusInfo} StatusInfo */

export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;
/** Verlängerungen bis zu so vielen Tagen darf man selbst vornehmen (nicht bei überfälligen) */
export const SELF_EXTEND_DAYS = 3;
export const MAX_PHOTOS = 5;
export const BULK_RENT_LIMIT = 50;

/** Ausleihbar = kein Verbrauchsmaterial und freigegeben
 * @param {Pick<CatalogItem,'item_type'|'status'>} i */
export const isBorrowable = (i) => i.item_type !== 'consumable' && i.status === 'active';

/** @param {{ end_at: string, status?: string }} r @param {Date} [now] */
export const isOverdue = (r, now = new Date()) => r.status !== 'returned' && new Date(r.end_at) < now;

/** Standardzeitraum einer neuen Ausleihe: volle Stunde jetzt bis +24 Stunden
 * @param {Date} [now] */
export function defaultWindow(now = new Date()) {
  const start = new Date(now); start.setMinutes(0, 0, 0);
  return { start, end: new Date(start.getTime() + DAY) };
}

/** Schnellwahl für den Zeitraum (Ende relativ zu jetzt)
 * @param {Date} [now] @returns {{ id: string, label: string, start: Date, end: Date }[]} */
export function quickWindows(now = new Date()) {
  const start = new Date(now); start.setMinutes(0, 0, 0);
  const at = (/** @type {Date} */ d, /** @type {number} */ h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
  const out = [];
  if (now.getHours() < 17) out.push({ id: 'today', label: 'Heute bis 18 Uhr', start, end: at(now, 18) });
  const tomorrow = new Date(now.getTime() + DAY);
  out.push({ id: 'tomorrow', label: 'Bis morgen 18 Uhr', start, end: at(tomorrow, 18) });
  // Wochenende: nächster Sonntag 18 Uhr
  const sunday = new Date(now); sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7 || 7));
  out.push({ id: 'weekend', label: 'Bis Sonntag 18 Uhr', start, end: at(sunday, 18) });
  out.push({ id: 'week', label: '1 Woche', start, end: new Date(start.getTime() + 7 * DAY) });
  return out;
}

/** Bestehende Buchungen, die sich mit [start, end) überschneiden
 * @param {Booking[]} bookings @param {Date} start @param {Date} end */
export const findConflicts = (bookings, start, end) => bookings.filter((b) => start < b.e && end > b.s);

/** Gibt es eine überfällige, noch nicht zurückgegebene Buchung?
 * @param {Booking[]} bookings @param {Date} [now] */
export const hasOverdue = (bookings, now = new Date()) => bookings.some((b) => b.e < now);

/** Prüft, ob ein Artikel im Zeitraum buchbar ist
 * @param {Booking[]} bookings @param {Date} start @param {Date} end @param {Date} [now]
 * @returns {{ ok: boolean, reason: null|'invalid'|'overdue'|'clash', clash: Booking[] }} */
export function checkAvailability(bookings, start, end, now = new Date()) {
  if (!(end > start)) return { ok: false, reason: 'invalid', clash: [] };
  if (hasOverdue(bookings, now)) return { ok: false, reason: 'overdue', clash: [] };
  const clash = findConflicts(bookings, start, end);
  return clash.length ? { ok: false, reason: 'clash', clash } : { ok: true, reason: null, clash: [] };
}

/** Muss die Verlängerung genehmigt werden?
 * @param {{ days: number, overdue: boolean, manager: boolean }} p */
export const extensionNeedsApproval = ({ days, overdue, manager }) => !manager && (days > SELF_EXTEND_DAYS || overdue);

/** Einheitlicher Status für Karten und Listen: Text, Symbol (nicht nur Farbe!) und Tonart
 * @param {CatalogItem} i @param {{ end_at: string }|null|undefined} rental @returns {StatusInfo} */
export function itemStatus(i, rental) {
  if (i.status === 'maintenance') return { kind: 'maintenance', label: 'Defekt / Wartung', icon: '🛠', tone: 'bad' };
  if (i.status === 'inventory') return { kind: 'inventory', label: 'In Inventur', icon: '📋', tone: 'info' };
  if (i.item_type === 'consumable') {
    const low = i.stock_quantity <= i.min_stock;
    return { kind: low ? 'stock_low' : 'stock', label: `Bestand: ${i.stock_quantity}`, icon: low ? '📉' : '📦', tone: low ? 'bad' : 'info' };
  }
  if (rental) return { kind: 'rented', label: 'Ausgeliehen', icon: '⏳', tone: 'warn' };
  return { kind: 'available', label: 'Verfügbar', icon: '✅', tone: 'ok' };
}

/** Prüfstatus für Karten/Listen
 * @param {{ next_inspection_at?: string|null }|null|undefined} item @param {Date} [now]
 * @returns {null|{ level: 'due'|'soon'|'ok', text: string }} */
export function inspectionState(item, now = new Date()) {
  if (!item?.next_inspection_at) return null;
  const next = new Date(item.next_inspection_at);
  const date = next.toLocaleDateString('de-DE');
  const days = Math.ceil((next.getTime() - now.getTime()) / DAY);
  if (days < 0) return { level: 'due', text: `Prüfung überfällig seit ${date}` };
  if (days <= 14) return { level: 'soon', text: `Prüfung fällig am ${date}` };
  return { level: 'ok', text: `Nächste Prüfung ${date}` };
}

/** Stufe der Rückgabe-Erinnerung (die Versandfunktion in der Datenbank verwendet dieselben Schwellen)
 * @param {{ end_at: string }} r @param {Date} [now]
 * @returns {null|'day_before'|'due_today'|'overdue'|'escalate'} */
export function reminderStage(r, now = new Date()) {
  const diff = new Date(r.end_at).getTime() - now.getTime();
  if (diff < -2 * DAY) return 'escalate';
  if (diff < 0) return 'overdue';
  if (diff <= 4 * HOUR) return 'due_today';
  if (diff <= DAY) return 'day_before';
  return null;
}
