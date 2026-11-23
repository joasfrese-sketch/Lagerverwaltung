import { describe, it, expect } from 'vitest';
import { guessMapping, buildItems, colLetter } from '../src/lib/import.js';

const rooms = [{ id: 'Technik', name: 'Technik' }, { id: 'Küche', name: 'Küche' }];

describe('Excel-Import', () => {
  it('erkennt Spalten an der Überschrift', () => {
    expect(guessMapping(['Bezeichnung', 'Raum', 'Menge', 'Unbekannt', 'Inventarnummer'])).toEqual(['name', 'room', 'stock', '', 'id']);
  });

  it('Spaltenbuchstaben', () => {
    expect([colLetter(0), colLetter(25), colLetter(26), colLetter(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
  });

  it('wandelt Zeilen in Artikel um und meldet Fehler', () => {
    const mapping = ['name', 'room', 'type', 'stock', 'accessories'];
    const res = buildItems([
      { line: 2, cells: ['Kamera', 'technik', 'Koffer', '2', 'Akku; Tasche'] },
      { line: 3, cells: ['Papier', 'Büro', 'Verbrauch', '10', ''] },
      { line: 4, cells: ['', 'Technik', '', '', ''] },
      { line: 5, cells: ['Topf', 'Küche', '', 'x', ''] },
    ], mapping, { rooms, defaultRoom: 'Technik', canManage: (r) => r === 'Technik' });
    expect(res[0]).toMatchObject({ ok: true, item: { name: 'Kamera', room_id: 'Technik', item_type: 'kit', stock_quantity: 2, accessories: ['Akku', 'Tasche'] } });
    expect(res[1]).toMatchObject({ ok: false, error: 'Raum „Büro" unbekannt' });
    expect(res[2]).toMatchObject({ ok: false, error: 'Bezeichnung fehlt' });
    expect(res[3]).toMatchObject({ ok: false, error: 'Keine Berechtigung für Raum „Küche"' });
  });
});
