// Reine Hilfsfunktionen für den Kalender (ohne DOM, testbar)

// Feste, gut unterscheidbare Farben (hell/dunkel lesbar mit weißer Schrift)
export const ROOM_PALETTE = ['#2563eb', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488', '#4f46e5', '#b45309'];

// Farbe pro Raum: eigene Farbe aus der Datenbank (rooms.color), sonst nach Sortierreihenfolge
export function roomColor(roomId, rooms = []) {
  const i = rooms.findIndex((r) => r.id === roomId);
  if (i >= 0 && rooms[i].color) return rooms[i].color;
  if (i >= 0) return ROOM_PALETTE[i % ROOM_PALETTE.length];
  let h = 0; for (const c of String(roomId || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ROOM_PALETTE[h % ROOM_PALETTE.length];
}

export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Montag 00:00 der Woche von d (lokale Zeit)
export function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

// ISO-Kalenderwoche
export function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - y0) / 86400000 + 1) / 7);
}

export const overlaps = (e, from, to) => new Date(e.start_at) < to && new Date(e.end_at) > from;

// Zeitraum, den die Ansicht lädt: { from, to } (to exklusiv)
export function viewRange(view, anchor) {
  if (view === 'week') { const from = startOfWeek(anchor); return { from, to: addDays(from, 7) }; }
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  return { from, to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) };
}

// Uhrzeit-Text eines Termins an einem bestimmten Tag ("ganztägig", "ab 10:00", "bis 12:00", "10:00–12:00")
export function dayLabel(e, d0) {
  const d1 = addDays(d0, 1); const s = new Date(e.start_at); const en = new Date(e.end_at);
  const t = (x) => x.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const startsToday = s >= d0; const endsToday = en <= d1;
  if (startsToday && endsToday) return `${t(s)}–${t(en)}`;
  if (startsToday) return `ab ${t(s)}`;
  if (endsToday) return `bis ${t(en)}`;
  return 'ganztägig';
}
