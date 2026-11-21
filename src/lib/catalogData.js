// @ts-check
// Datenzugriff des Katalogs (Abfragen und Aktionen gegen die Datenbank) – ohne Oberfläche.
import { supabase, unwrap, safeData } from './supabase.js';

/** Filter der Katalogliste auf eine Abfrage anwenden (gleiche Regeln für Liste, „Alle auswählen“ und Export)
 * @param {any} q Supabase-Abfrage auf catalog_items
 * @param {{ room: string, search: string, status: string, category: string, type: string }} f */
export function applyCatalogFilter(q, f) {
  if (f.room !== 'ALL') q = q.eq('room_id', f.room);
  const term = f.search.trim().replace(/[%,()]/g, ' ');
  if (term) q = q.or(`name.ilike.%${term}%,category.ilike.%${term}%,id.ilike.%${term}%`);
  if (f.status === 'avail') q = q.eq('status', 'active').or('and(item_type.neq.consumable,rented_now.eq.false),and(item_type.eq.consumable,stock_quantity.gt.0)');
  else if (f.status === 'rented') q = q.eq('rented_now', true);
  else if (f.status === 'maintenance') q = q.eq('status', 'maintenance');
  else if (f.status === 'inventory') q = q.eq('status', 'inventory');
  else if (f.status === 'low') q = q.eq('low_stock', true);
  else if (f.status === 'inspection') q = q.eq('inspection_due', true);
  if (f.category) q = q.eq('category', f.category);
  if (f.type) q = q.eq('item_type', f.type);
  return q;
}

/** @param {string} [cols] @param {{ count?: 'exact', head?: boolean }} [opts] */
export const catalogQuery = (cols = '*', opts) => supabase.from('catalog_items').select(cols, opts);

/** Anzahl Artikel je Raum
 * @returns {Promise<{ total: number, byRoom: Record<string, number> }>} */
export async function roomCounts() {
  /** @type {{ room_id: string }[]} */
  const items = unwrap(await supabase.from('items').select('room_id'));
  return { total: items.length, byRoom: items.reduce((m, i) => ((m[i.room_id] = (m[i.room_id] || 0) + 1), m), /** @type {Record<string, number>} */ ({})) };
}

/** Kategorien eines Raums (oder aller Räume) */
/** @param {string} room @returns {Promise<string[]>} */
export async function categories(room) {
  let q = supabase.from('items').select('category').limit(5000);
  if (room !== 'ALL') q = q.eq('room_id', room);
  /** @type {{ category: string|null }[]} */
  const rows = await safeData(q);
  return /** @type {string[]} */ ([...new Set(rows.map((r) => r.category).filter((c) => !!c))]).sort((a, b) => a.localeCompare(b, 'de'));
}

/** Artikel der Liste samt Gesamtzahl */
/** @param {Parameters<typeof applyCatalogFilter>[1]} filter @param {[string, boolean]} sort @param {number} [limit] */
export async function listItems(filter, [col, asc], limit = 200) {
  const { data, count, error } = await applyCatalogFilter(catalogQuery('*', { count: 'exact' }), filter).order(col, { ascending: asc }).order('name').limit(limit);
  if (error) throw new Error(error.message);
  return { data, count };
}

/** IDs aller Artikel, auf denen ich in der Warteliste stehe */
export async function waitlistIds() {
  /** @type {{ item_id: string }[]} */
  const rows = await safeData(supabase.from('waitlist').select('item_id'));
  return new Set(rows.map((w) => w.item_id));
}

/** Auswahl „Alle“: IDs + Felder für die Berechtigungsprüfung */
/** @param {Parameters<typeof applyCatalogFilter>[1]} filter */
export async function selectableRows(filter) {
  return unwrap(await applyCatalogFilter(catalogQuery('id, room_id, item_type, status'), filter).order('id').range(0, 4999));
}

/** @param {string[]} ids @returns {Promise<import('./types.js').CatalogItem[]>} */
export async function itemsByIds(ids) {
  /** @type {any[]} */
  let out = [];
  for (let i = 0; i < ids.length; i += 100) out = out.concat(unwrap(await supabase.from('items').select('*').in('id', ids.slice(i, i + 100))));
  return out;
}

export async function people() {
  return unwrap(await supabase.from('public_profiles').select('id, full_name, username').order('full_name'));
}

/** Aktive Buchungen der letzten 35 Tage und künftig für die genannten Artikel
 * @returns {Promise<(import('./types.js').Booking & { id: string })[]>} */
/** @param {string[]} itemIds */
export async function bookingsFor(itemIds) {
  const from = new Date(); from.setDate(from.getDate() - 35);
  /** @type {{ item_id: string, start_at: string, end_at: string }[]} */
  const rows = await safeData(supabase.from('rental_calendar').select('item_id, start_at, end_at').in('item_id', itemIds).eq('status', 'active').gte('end_at', from.toISOString()));
  return rows.map((b) => ({ id: b.item_id, s: new Date(b.start_at), e: new Date(b.end_at) }));
}

// ----- Aktionen -----
/** @param {Record<string, unknown>} a */
export const rentItem = async (a) => unwrap(await supabase.rpc('rent_item', a));
/** @param {Record<string, unknown>} a */
export const rentItems = async (a) => unwrap(await supabase.rpc('rent_items', a));
/** @param {Record<string, unknown>} a */
export const consumeItem = async (a) => unwrap(await supabase.rpc('consume_item', a));
/** @param {string} id @param {string} status */
export const setItemStatus = async (id, status) => unwrap(await supabase.rpc('set_item_status', { p_item_id: id, p_status: status }));
/** @param {string[]} ids @param {string} status */
export const bulkSetStatus = async (ids, status) => unwrap(await supabase.rpc('bulk_set_item_status', { p_ids: ids, p_status: status }));
/** @param {string} id @param {boolean} on */
export const toggleWaitlist = async (id, on) => unwrap(await supabase.rpc(on ? 'leave_waitlist' : 'join_waitlist', { p_item_id: id }));
