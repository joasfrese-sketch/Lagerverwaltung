// Inventur: Soll/Ist-Vergleich (reine Funktion, testbar)
// roomItems: Artikel des Raums [{ id, name, rented_now, ... }]
// scanned:   Map<code, item|null> – alle gescannten Codes; item = Datensatz falls bekannt (auch aus anderen Räumen)
export function diffInventory(roomItems, scanned, roomId) {
  const inRoom = new Map(roomItems.map((i) => [i.id, i]));
  const found = []; const missing = []; const rented = []; const unexpected = []; const unknown = [];
  for (const i of roomItems) {
    if (scanned.has(i.id)) found.push(i);
    else if (i.rented_now) rented.push(i);
    else missing.push(i);
  }
  for (const [code, item] of scanned) {
    if (inRoom.has(code)) continue;
    if (!item) unknown.push(code);
    else if (item.room_id !== roomId) unexpected.push(item);
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'de');
  return {
    expected: found.length + missing.length,
    found: found.sort(byName), missing: missing.sort(byName), rented: rented.sort(byName),
    unexpected: unexpected.sort(byName), unknown: unknown.sort(),
  };
}

// Normalisiert gescannten Text zu einer Artikel-ID (ITEM:..., URL mit ?item=..., reine ID)
export function codeToItemId(raw) {
  let code = String(raw ?? '').trim();
  if (!code) return null;
  try { const u = new URL(code); if (u.searchParams.get('item')) code = u.searchParams.get('item'); } catch { /* kein URL */ }
  if (code.startsWith('USER:') || code.startsWith('ROOM:')) return null;
  return code.startsWith('ITEM:') ? code.slice(5).trim() || null : code;
}

// Differenzliste als Tabellenzeilen (für Export/Druck). result = Antwort von save_inventory oder diffInventory
export function diffRows(result, roomId) {
  const rows = [];
  const add = (label, list, raum) => (list || []).forEach((x) => rows.push(typeof x === 'string'
    ? { ergebnis: label, id: x, name: '', raum: '' }
    : { ergebnis: label, id: x.id, name: x.name, raum: raum(x) }));
  add('Fehlt', result.missing, () => roomId);
  add('Fremder Raum', result.unexpected, (x) => x.room || x.room_id || '');
  add('Unbekannter Code', result.unknown, () => '');
  add('Ausgeliehen (nicht geprüft)', result.rented, () => roomId);
  return rows;
}
