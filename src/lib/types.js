// Gemeinsame Typbeschreibungen (JSDoc) für Datenbankzeilen. Wird mit `npm run typecheck` geprüft.

/** @typedef {'standard'|'kit'|'consumable'} ItemType */
/** @typedef {'active'|'maintenance'|'inventory'} ItemStatus */

/**
 * Zeile der Ansicht catalog_items (Artikel + berechnete Felder)
 * @typedef {object} CatalogItem
 * @property {string} id
 * @property {string} name
 * @property {string} room_id
 * @property {string|null} category
 * @property {ItemType} item_type
 * @property {ItemStatus} status
 * @property {string|null} shelf
 * @property {string|null} compartment
 * @property {string[]} accessories
 * @property {string[]} photos
 * @property {number} stock_quantity
 * @property {number} min_stock
 * @property {number|null} inspection_interval_months
 * @property {string|null} last_inspection_at
 * @property {string|null} next_inspection_at
 * @property {boolean} [rented_now]
 * @property {string|null} [rented_until]
 * @property {boolean} [low_stock]
 * @property {boolean} [inspection_due]
 */

/**
 * Buchung eines Artikels (Ausschnitt aus rentals / rental_calendar)
 * @typedef {object} Booking
 * @property {string} [id]
 * @property {Date} s Beginn
 * @property {Date} e Ende
 */

/**
 * @typedef {object} Rental
 * @property {string} id
 * @property {string} item_id
 * @property {string} start_at
 * @property {string} end_at
 * @property {'active'|'returned'} status
 * @property {string|null} [project]
 */

/** @typedef {{ kind: string, label: string, icon: string, tone: 'ok'|'warn'|'bad'|'info' }} StatusInfo */

export {};
