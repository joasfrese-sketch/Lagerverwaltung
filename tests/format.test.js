import { describe, it, expect } from 'vitest';
import { displayName, suggestUsername, timeAgo } from '../src/lib/format.js';
import { esc } from '../src/lib/ui.js';
import { inspectionState } from '../src/components/inspection.js';

describe('Anzeige', () => {
  it('zeigt nie eine E-Mail als Namen', () => {
    expect(displayName({ full_name: 'max@x.de', username: 'max' })).toBe('max');
    expect(displayName({ full_name: ' Uta ', username: 'uta' })).toBe('Uta');
  });
  it('schlägt Benutzernamen vor', () => {
    expect(suggestUsername('Jörg Müller-Weiß')).toBe('joerg.mueller.weiss');
  });
  it('maskiert HTML (Schutz vor XSS)', () => {
    expect(esc('<img src=x onerror="a">')).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;');
  });
  it('relative Zeitangaben', () => {
    const now = new Date(2026, 0, 10, 12, 0);
    expect(timeAgo(new Date(2026, 0, 10, 11, 59, 50), now)).toBe('gerade eben');
    expect(timeAgo(new Date(2026, 0, 10, 11, 30), now)).toBe('vor 30 Min.');
    expect(timeAgo(new Date(2026, 0, 9, 8, 5), now)).toBe('gestern, 08:05 Uhr');
  });
  it('Prüfstatus', () => {
    const now = new Date(2026, 0, 10);
    expect(inspectionState({}, now)).toBeNull();
    expect(inspectionState({ next_inspection_at: new Date(2026, 0, 1).toISOString() }, now).level).toBe('due');
    expect(inspectionState({ next_inspection_at: new Date(2026, 0, 20).toISOString() }, now).level).toBe('soon');
    expect(inspectionState({ next_inspection_at: new Date(2026, 5, 1).toISOString() }, now).level).toBe('ok');
  });
});
