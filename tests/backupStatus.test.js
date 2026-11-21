import { describe, it, expect } from 'vitest';
import { backupAgeDays } from '../src/lib/backupStatus.js';

describe('Sicherungsalter', () => {
  const now = new Date('2026-05-10T12:00:00Z');
  it('keine Sicherung = null', () => { expect(backupAgeDays(null, now)).toBeNull(); expect(backupAgeDays(undefined, now)).toBeNull(); });
  it('rechnet in Tagen', () => {
    expect(backupAgeDays('2026-05-10T00:00:00Z', now)).toBeCloseTo(0.5);
    expect(backupAgeDays('2026-05-07T12:00:00Z', now)).toBeCloseTo(3);
  });
});
