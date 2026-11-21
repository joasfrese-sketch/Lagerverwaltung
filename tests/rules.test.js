import { describe, it, expect } from 'vitest';
import { isBorrowable, isOverdue, defaultWindow, quickWindows, findConflicts, hasOverdue, checkAvailability, extensionNeedsApproval, itemStatus, inspectionState, reminderStage, HOUR, DAY } from '../src/lib/rules.js';

const d = (s) => new Date(s);
const bk = (s, e) => ({ s: d(s), e: d(e) });

describe('Ausleih-Regeln', () => {
  it('ausleihbar nur bei freigegebenem Nicht-Verbrauchsmaterial', () => {
    expect(isBorrowable({ item_type: 'standard', status: 'active' })).toBe(true);
    expect(isBorrowable({ item_type: 'kit', status: 'active' })).toBe(true);
    expect(isBorrowable({ item_type: 'consumable', status: 'active' })).toBe(false);
    expect(isBorrowable({ item_type: 'standard', status: 'maintenance' })).toBe(false);
  });
  it('Überfälligkeit', () => {
    const now = d('2026-05-10T12:00:00Z');
    expect(isOverdue({ end_at: '2026-05-10T11:00:00Z', status: 'active' }, now)).toBe(true);
    expect(isOverdue({ end_at: '2026-05-10T13:00:00Z', status: 'active' }, now)).toBe(false);
    expect(isOverdue({ end_at: '2026-05-01T00:00:00Z', status: 'returned' }, now)).toBe(false);
  });
  it('Überschneidung: angrenzende Zeiträume kollidieren nicht', () => {
    const b = [bk('2026-05-10T10:00:00Z', '2026-05-10T12:00:00Z')];
    expect(findConflicts(b, d('2026-05-10T12:00:00Z'), d('2026-05-10T14:00:00Z'))).toHaveLength(0);
    expect(findConflicts(b, d('2026-05-10T11:59:00Z'), d('2026-05-10T14:00:00Z'))).toHaveLength(1);
    expect(findConflicts(b, d('2026-05-09T00:00:00Z'), d('2026-05-11T00:00:00Z'))).toHaveLength(1);
  });
  it('Verfügbarkeit: ungültig, überfällig, belegt, frei', () => {
    const now = d('2026-05-10T12:00:00Z');
    const s = d('2026-05-11T08:00:00Z'); const e = d('2026-05-11T18:00:00Z');
    expect(checkAvailability([], e, s, now).reason).toBe('invalid');
    expect(checkAvailability([bk('2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z')], s, e, now).reason).toBe('overdue');
    expect(checkAvailability([bk('2026-05-11T10:00:00Z', '2026-05-12T00:00:00Z')], s, e, now).reason).toBe('clash');
    expect(checkAvailability([bk('2026-05-12T10:00:00Z', '2026-05-13T00:00:00Z')], s, e, now)).toMatchObject({ ok: true, reason: null });
    expect(hasOverdue([bk('2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z')], now)).toBe(true);
  });
  it('Verlängerung: bis 3 Tage selbst, Manager immer, Überfällige nur mit Genehmigung', () => {
    expect(extensionNeedsApproval({ days: 3, overdue: false, manager: false })).toBe(false);
    expect(extensionNeedsApproval({ days: 3.1, overdue: false, manager: false })).toBe(true);
    expect(extensionNeedsApproval({ days: 1, overdue: true, manager: false })).toBe(true);
    expect(extensionNeedsApproval({ days: 30, overdue: true, manager: true })).toBe(false);
  });
});

describe('Zeiträume', () => {
  it('Standardzeitraum: volle Stunde, 24 h', () => {
    const w = defaultWindow(d('2026-05-10T09:42:10'));
    expect(w.start.getMinutes()).toBe(0); expect(w.end - w.start).toBe(DAY);
  });
  it('Schnellwahl: heute nur vor 17 Uhr, Ende immer nach Beginn', () => {
    const morning = quickWindows(d('2026-05-12T09:15:00'));
    expect(morning.map((w) => w.id)).toContain('today');
    const evening = quickWindows(d('2026-05-12T19:15:00'));
    expect(evening.map((w) => w.id)).not.toContain('today');
    for (const w of [...morning, ...evening]) expect(w.end > w.start).toBe(true);
  });
  it('Wochenende endet am Sonntag', () => {
    const w = quickWindows(d('2026-05-12T09:15:00')).find((x) => x.id === 'weekend');
    expect(w.end.getDay()).toBe(0);
  });
});

describe('Status und Prüfung', () => {
  const base = { item_type: 'standard', status: 'active', stock_quantity: 1, min_stock: 0 };
  it('Status hat Symbol und Text (nicht nur Farbe)', () => {
    expect(itemStatus({ ...base, status: 'maintenance' }).kind).toBe('maintenance');
    expect(itemStatus({ ...base, status: 'inventory' }).kind).toBe('inventory');
    expect(itemStatus({ ...base, item_type: 'consumable', stock_quantity: 2, min_stock: 2 }).kind).toBe('stock_low');
    expect(itemStatus({ ...base, item_type: 'consumable', stock_quantity: 9, min_stock: 2 }).kind).toBe('stock');
    expect(itemStatus(base, { end_at: 'x' }).kind).toBe('rented');
    const ok = itemStatus(base, null);
    expect(ok).toMatchObject({ kind: 'available', tone: 'ok' }); expect(ok.icon).toBeTruthy(); expect(ok.label).toBeTruthy();
  });
  it('Prüfstatus', () => {
    const now = d('2026-05-10T00:00:00Z');
    expect(inspectionState(null, now)).toBeNull();
    expect(inspectionState({ next_inspection_at: '2026-05-01T00:00:00Z' }, now).level).toBe('due');
    expect(inspectionState({ next_inspection_at: '2026-05-20T00:00:00Z' }, now).level).toBe('soon');
    expect(inspectionState({ next_inspection_at: '2026-09-01T00:00:00Z' }, now).level).toBe('ok');
  });
});

describe('Rückgabe-Erinnerung', () => {
  const now = d('2026-05-10T12:00:00Z');
  const at = (ms) => ({ end_at: new Date(now.getTime() + ms).toISOString() });
  it('Stufen', () => {
    expect(reminderStage(at(3 * DAY), now)).toBeNull();
    expect(reminderStage(at(20 * HOUR), now)).toBe('day_before');
    expect(reminderStage(at(2 * HOUR), now)).toBe('due_today');
    expect(reminderStage(at(-HOUR), now)).toBe('overdue');
    expect(reminderStage(at(-3 * DAY), now)).toBe('escalate');
  });
});
