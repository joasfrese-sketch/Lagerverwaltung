import { describe, it, expect } from 'vitest';
import { diffInventory, codeToItemId, diffRows } from '../src/lib/inventory.js';

const room = [
  { id: 'A1', name: 'Akkuschrauber', room_id: 'Technik', rented_now: false },
  { id: 'B2', name: 'Beamer', room_id: 'Technik', rented_now: true },
  { id: 'C3', name: 'Kabeltrommel', room_id: 'Technik', rented_now: false },
];

describe('Inventur', () => {
  it('vergleicht Soll und Ist', () => {
    const scanned = new Map([['A1', room[0]], ['K9', { id: 'K9', name: 'Topf', room_id: 'Küche' }], ['XX', null]]);
    const d = diffInventory(room, scanned, 'Technik');
    expect(d.found.map((i) => i.id)).toEqual(['A1']);
    expect(d.missing.map((i) => i.id)).toEqual(['C3']);
    expect(d.rented.map((i) => i.id)).toEqual(['B2']);
    expect(d.unexpected.map((i) => i.id)).toEqual(['K9']);
    expect(d.unknown).toEqual(['XX']);
    expect(d.expected).toBe(2);
  });

  it('ein gescannter ausgeliehener Artikel zählt als gefunden', () => {
    const d = diffInventory(room, new Map([['B2', room[1]]]), 'Technik');
    expect(d.found.map((i) => i.id)).toEqual(['B2']);
    expect(d.expected).toBe(3);
  });

  it('liest verschiedene Code-Formate', () => {
    expect(codeToItemId('ITEM:ART-1001')).toBe('ART-1001');
    expect(codeToItemId(' ART-1001 ')).toBe('ART-1001');
    expect(codeToItemId('https://lager.example/?item=ART-7')).toBe('ART-7');
    expect(codeToItemId('USER:abc')).toBeNull();
    expect(codeToItemId('ROOM:Technik')).toBeNull();
    expect(codeToItemId('')).toBeNull();
  });

  it('erstellt die Differenzliste für den Export', () => {
    const rows = diffRows({ missing: [{ id: 'C3', name: 'Kabeltrommel' }], unexpected: [{ id: 'K9', name: 'Topf', room: 'Küche' }], unknown: ['XX'], rented: [] }, 'Technik');
    expect(rows).toEqual([
      { ergebnis: 'Fehlt', id: 'C3', name: 'Kabeltrommel', raum: 'Technik' },
      { ergebnis: 'Fremder Raum', id: 'K9', name: 'Topf', raum: 'Küche' },
      { ergebnis: 'Unbekannter Code', id: 'XX', name: '', raum: '' },
    ]);
  });
});
