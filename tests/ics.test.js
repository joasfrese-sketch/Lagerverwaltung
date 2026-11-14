import { describe, it, expect } from 'vitest';
import { buildIcs, foldLine, icsEscape, rentalToEvent } from '../supabase/functions/_shared/ics.js';

describe('iCalendar', () => {
  it('maskiert Sonderzeichen', () => {
    expect(icsEscape('a;b,c\\d\ne')).toBe('a\;b\\,c\\\\d\\ne');
  });

  it('faltet lange Zeilen auf höchstens 75 Byte', () => {
    const line = 'SUMMARY:' + 'Ä'.repeat(100);
    const parts = foldLine(line).split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75));
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
  });

  it('erzeugt einen gültigen Kalender mit Termin', () => {
    const ics = buildIcs([{ uid: 'x@lager', start: '2026-05-01T08:00:00Z', end: '2026-05-02T10:30:00Z', summary: 'Ausleihe: Kamera' }], { now: new Date('2026-04-01T00:00:00Z') });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20260501T080000Z');
    expect(ics).toContain('DTEND:20260502T103000Z');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.split('BEGIN:VEVENT').length).toBe(2);
  });

  it('wandelt Ausleihen in Termine um (früh zurückgegeben = kürzer)', () => {
    const e = rentalToEvent({ id: 'r1', item_id: 'T-1', item_name: 'Beamer', room_id: 'Technik', start_at: '2026-05-01T08:00:00Z', end_at: '2026-05-05T08:00:00Z', status: 'returned', returned_at: '2026-05-03T08:00:00Z', borrower_name: 'Uta', own: false, project: 'Fest' });
    expect(e.end).toBe('2026-05-03T08:00:00Z');
    expect(e.summary).toBe('✓ Ausleihe: Beamer – Uta');
    expect(e.description).toContain('Projekt: Fest');
  });
});
