import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { normalizePhone, parseWebhook, verifySignature, outboundText, templateParam, interpretSendResult, prettyPhone } from '../supabase/functions/_shared/whatsapp.js';

describe('WhatsApp: Rufnummern', () => {
  it('normalisiert verschiedene Schreibweisen', () => {
    expect(normalizePhone('+49 (151) 234-567 89')).toEqual({ ok: true, phone: '4915123456789' });
    expect(normalizePhone('0049 151 23456789')).toEqual({ ok: true, phone: '4915123456789' });
    expect(prettyPhone('4915123456789')).toBe('+4915123456789');
  });
  it('lehnt Nummern ohne Ländervorwahl, zu kurze und fehlerhafte ab', () => {
    expect(normalizePhone('0151 23456789').ok).toBe(false);
    expect(normalizePhone('+49 12').ok).toBe(false);
    expect(normalizePhone('+49abc12345678').ok).toBe(false);
    expect(normalizePhone('').ok).toBe(false);
  });
});

const payload = (messages, contacts = [{ wa_id: '4915111111111', profile: { name: 'Anna' } }]) => ({ entry: [{ changes: [{ value: { contacts, messages } }] }] });

describe('WhatsApp: eingehende Nachrichten', () => {
  it('liest Textnachrichten mit Namen', () => {
    const r = parseWebhook(payload([{ from: '4915111111111', id: 'wamid.A', type: 'text', text: { body: ' Hallo ' } }]));
    expect(r).toEqual([{ from: '4915111111111', name: 'Anna', body: 'Hallo', id: 'wamid.A', type: 'text' }]);
  });
  it('kennzeichnet Anhänge, ignoriert Reaktionen und Statusmeldungen', () => {
    const r = parseWebhook(payload([
      { from: '4915111111111', id: 'w1', type: 'image', image: { caption: 'Zelt' } },
      { from: '4915111111111', id: 'w2', type: 'audio' },
      { from: '4915111111111', id: 'w3', type: 'reaction', reaction: { emoji: '👍' } },
    ]));
    expect(r.map((m) => m.body)).toEqual(['📎 Bild (nur in WhatsApp sichtbar): Zelt', '📎 Sprachnachricht (nur in WhatsApp sichtbar)']);
    expect(parseWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] })).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
  });
  it('überspringt leere Nachrichten und Einträge ohne ID', () => {
    expect(parseWebhook(payload([{ from: '49151', id: 'a', type: 'text', text: { body: '   ' } }, { from: '49151', type: 'text', text: { body: 'x' } }]))).toEqual([]);
  });
});

describe('WhatsApp: Signatur', () => {
  const secret = 'app-secret'; const body = '{"entry":[]}';
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  it('akzeptiert die richtige Signatur', async () => { expect(await verifySignature(body, sig, secret)).toBe(true); });
  it('lehnt falsche, fehlende und manipulierte ab', async () => {
    expect(await verifySignature(body + ' ', sig, secret)).toBe(false);
    expect(await verifySignature(body, sig, 'anderes-secret')).toBe(false);
    expect(await verifySignature(body, null, secret)).toBe(false);
    expect(await verifySignature(body, 'sha256=abc', secret)).toBe(false);
    expect(await verifySignature(body, sig, '')).toBe(false);
  });
});

describe('WhatsApp: Ausgang', () => {
  it('stellt den Absender fett voran', () => {
    expect(outboundText('Joas', 'Hallo')).toBe('*Joas:* Hallo');
    expect(outboundText('Jo*as', 'x')).toBe('*Joas:* x');
  });
  it('bereinigt Vorlagen-Parameter', () => {
    expect(templateParam('a\nb\t c      d')).toBe('a b  c   d');
    expect(templateParam('')).toBe('-');
  });
  it('wertet Antworten der Schnittstelle aus', () => {
    expect(interpretSendResult(200, { messages: [{ id: 'wamid.X' }] })).toEqual({ ok: true, id: 'wamid.X' });
    expect(interpretSendResult(400, { error: { code: 131047, message: 'x' } }).error).toContain('24-Stunden');
    expect(interpretSendResult(401, { error: { code: 190, message: 'x' } }).error).toContain('Zugangstoken');
    expect(interpretSendResult(500, null)).toEqual({ ok: false, error: 'HTTP 500' });
  });
});
