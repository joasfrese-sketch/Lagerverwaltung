import { describe, it, expect } from 'vitest';
import { startOfWeek, isoWeek, overlaps, viewRange, roomColor, ROOM_PALETTE, dayLabel, addDays } from '../src/lib/calendar.js';

describe('Kalender-Helfer', () => {
  it('Wochenbeginn ist Montag', () => {
    expect(startOfWeek(new Date(2026, 10, 14)).getDay()).toBe(1); // Samstag -> Montag
    expect(startOfWeek(new Date(2026, 10, 15)).getDate()).toBe(9);  // Sonntag gehört zur Woche ab 9.11.
    expect(startOfWeek(new Date(2026, 10, 9, 15)).getDate()).toBe(9);
  });

  it('ISO-Kalenderwoche', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2026, 10, 14))).toBe(46);
  });

  it('Überschneidung (Ende exklusiv)', () => {
    const e = { start_at: new Date(2026, 0, 1, 10).toISOString(), end_at: new Date(2026, 0, 2, 0).toISOString() };
    expect(overlaps(e, new Date(2026, 0, 1), new Date(2026, 0, 2))).toBe(true);
    expect(overlaps(e, new Date(2026, 0, 2), new Date(2026, 0, 3))).toBe(false);
  });

  it('Ladebereich je Ansicht', () => {
    const w = viewRange('week', new Date(2026, 10, 14));
    expect(w.to - w.from).toBe(7 * 86400000);
    const m = viewRange('month', new Date(2026, 1, 20));
    expect(m.from.getDate()).toBe(1);
    expect(m.to.getMonth()).toBe(2);
  });

  it('Farbe pro Raum ist stabil, eigene Farbe hat Vorrang', () => {
    const rooms = [{ id: 'A' }, { id: 'B', color: '#123456' }];
    expect(roomColor('A', rooms)).toBe(ROOM_PALETTE[0]);
    expect(roomColor('B', rooms)).toBe('#123456');
    expect(roomColor('X', rooms)).toBe(roomColor('X', rooms));
    expect(ROOM_PALETTE).toContain(roomColor('X', rooms));
  });

  it('Uhrzeit-Text pro Tag', () => {
    const d0 = new Date(2026, 0, 5);
    const ev = (s, e) => ({ start_at: s.toISOString(), end_at: e.toISOString() });
    expect(dayLabel(ev(new Date(2026, 0, 5, 9), new Date(2026, 0, 5, 12)), d0)).toBe('09:00–12:00');
    expect(dayLabel(ev(new Date(2026, 0, 5, 9), new Date(2026, 0, 7)), d0)).toBe('ab 09:00');
    expect(dayLabel(ev(new Date(2026, 0, 3), new Date(2026, 0, 5, 12)), d0)).toBe('bis 12:00');
    expect(dayLabel(ev(new Date(2026, 0, 3), addDays(d0, 3)), d0)).toBe('ganztägig');
  });
});
