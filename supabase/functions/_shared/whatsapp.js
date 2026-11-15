// WhatsApp-Anbindung (offizielle Cloud API): reine Hilfsfunktionen ohne Abhängigkeiten.
// Genutzt von den Edge Functions „whatsapp-webhook“ / „whatsapp-send“ und von der App (Rufnummern-Prüfung).

// Rufnummer -> nur Ziffern mit Ländervorwahl (E.164 ohne „+“). Eingabe muss mit + oder 00 beginnen.
export function normalizePhone(input) {
  let s = String(input ?? '').trim().replace(/[\s().\-/]/g, '');
  if (!s) return { ok: false, error: 'Bitte eine Rufnummer eingeben.' };
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith('0')) return { ok: false, error: 'Bitte mit Ländervorwahl eingeben, z. B. +49 151 23456789 (statt 0151 …).' };
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: 'Die Rufnummer darf nur Ziffern enthalten.' };
  if (s.length < 8 || s.length > 15) return { ok: false, error: 'Die Rufnummer hat eine ungültige Länge.' };
  return { ok: true, phone: s };
}

export const prettyPhone = (p) => (p ? '+' + p : '');

const TYPE_LABEL = { image: 'Bild', video: 'Video', audio: 'Sprachnachricht', voice: 'Sprachnachricht', document: 'Dokument', sticker: 'Sticker', location: 'Standort', contacts: 'Kontakt' };

// Wandelt den Webhook-Inhalt von Meta in einfache Nachrichten um. Statusmeldungen und Reaktionen werden ignoriert.
export function parseWebhook(payload) {
  const out = [];
  for (const entry of payload?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      const v = ch?.value;
      if (!v?.messages) continue;
      const names = Object.fromEntries((v.contacts ?? []).map((c) => [String(c.wa_id), c?.profile?.name ?? '']));
      for (const m of v.messages) {
        const from = String(m.from ?? '');
        if (!from || !m.id) continue;
        let body = '';
        if (m.type === 'text') body = m.text?.body ?? '';
        else if (m.type === 'button') body = m.button?.text ?? '';
        else if (m.type === 'interactive') body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
        else if (m.type === 'reaction' || m.type === 'unsupported' || m.type === 'system') continue;
        else {
          const label = TYPE_LABEL[m.type] ?? 'Anhang';
          const caption = m[m.type]?.caption ?? '';
          body = `📎 ${label} (nur in WhatsApp sichtbar)${caption ? ': ' + caption : ''}`;
        }
        body = String(body).trim();
        if (!body) continue;
        out.push({ from, name: names[from] ?? '', body, id: String(m.id), type: m.type });
      }
    }
  }
  return out;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Prüft die Signatur „X-Hub-Signature-256: sha256=…“ (HMAC-SHA256 des Rohtexts mit dem App-Secret)
export async function verifySignature(rawBody, header, secret) {
  if (!secret || !header || !String(header).startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const given = String(header).slice(7).toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Text für WhatsApp: Absender in Fettschrift davor (WhatsApp: *fett*)
export const outboundText = (sender, body) => `*${String(sender || 'Lager-Chat').replace(/\*/g, '')}:* ${body}`.slice(0, 4000);

// Vorlagen-Parameter dürfen keine Zeilenumbrüche/Tabs und keine 4+ Leerzeichen enthalten
export const templateParam = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000) || '-';

// Antwort der Graph-API -> { ok, id?, error? }
export function interpretSendResult(status, json) {
  if (status >= 200 && status < 300 && json?.messages?.[0]?.id) return { ok: true, id: json.messages[0].id };
  const e = json?.error;
  const code = e?.code;
  let error = e?.message || `HTTP ${status}`;
  if (code === 131047 || code === 131026) error = '24-Stunden-Fenster abgeschlossen oder Nummer nicht erreichbar – Person muss zuerst schreiben (oder Vorlage einrichten).';
  else if (code === 190) error = 'Zugangstoken ungültig oder abgelaufen.';
  else if (code === 131030) error = 'Nummer steht nicht auf der Testempfänger-Liste.';
  return { ok: false, error: String(error).slice(0, 500) };
}
