import { describe, it, expect } from 'vitest';
import { generatePassword, checkPassword } from '../src/lib/password.js';

describe('Passwörter', () => {
  it('erzeugt zufällige Passwörter ohne verwechselbare Zeichen', () => {
    const a = generatePassword(); const b = generatePassword();
    expect(a).toHaveLength(12); expect(a).not.toBe(b);
    expect(/^[A-HJ-NP-Za-km-z2-9]+$/.test(a)).toBe(true);
    expect(generatePassword(20)).toHaveLength(20);
  });
  it('erzeugte Passwörter erfüllen die eigene Prüfung', () => {
    for (let i = 0; i < 50; i++) expect(checkPassword(generatePassword())).toBeNull();
  });
  it('lehnt schwache Passwörter ab', () => {
    expect(checkPassword('1234567')).toMatch(/mindestens 8/);
    expect(checkPassword('1234567890')).toMatch(/zu einfach/);
    expect(checkPassword('Passwort')).toMatch(/zu einfach/);
    expect(checkPassword('aaaaaaaaa')).toMatch(/wiederholen/);
    expect(checkPassword('98765432')).toMatch(/Ziffern/);
    expect(checkPassword('x'.repeat(73) + 'y')).toMatch(/höchstens 72/);
  });
  it('akzeptiert ordentliche Passwörter', () => {
    expect(checkPassword('Lager-Team 2026!')).toBeNull();
    expect(checkPassword('Sonne7Mond')).toBeNull();
  });
});
