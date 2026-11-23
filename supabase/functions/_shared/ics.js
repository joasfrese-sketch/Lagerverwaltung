// iCalendar (RFC 5545) ohne Abhängigkeiten – genutzt von der App (Einzel-Download)
// und von der Edge Function „calendar-feed" (abonnierbarer Link).

const utc = (d) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, '');

export const icsEscape = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Zeilen länger als 75 Byte (UTF-8) werden gefaltet: CRLF + Leerzeichen
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = []; let cur = ''; let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// events: [{ uid, start, end, summary, description?, location?, status? ('CONFIRMED'|'CANCELLED'), categories? }]
export function buildIcs(events, { name = 'Lagerverwaltung', now = new Date(), refreshHours = 1 } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lagerverwaltung Pro//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`, `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshHours}H`, `X-PUBLISHED-TTL:PT${refreshHours}H`];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${icsEscape(e.uid)}`, `DTSTAMP:${utc(now)}`, `DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.categories) lines.push(`CATEGORIES:${icsEscape(e.categories)}`);
    lines.push(`STATUS:${e.status || 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Ausleihe (Zeile aus rental_calendar bzw. calendar_feed_events) -> Termin
export function rentalToEvent(r) {
  const returned = r.status === 'returned';
  const who = r.borrower_name && !r.own ? ` – ${r.borrower_name}` : '';
  return {
    uid: `${r.id}@lagerverwaltung`,
    start: r.start_at,
    end: returned && r.returned_at && new Date(r.returned_at) < new Date(r.end_at) ? r.returned_at : r.end_at,
    summary: `${returned ? '✓ ' : ''}Ausleihe: ${r.item_name}${who}`,
    description: [r.project && `Projekt: ${r.project}`, `Artikel-ID: ${r.item_id}`, returned ? 'Zurückgegeben' : null].filter(Boolean).join('\n'),
    location: r.room_id || '',
    categories: r.room_id || '',
  };
}
