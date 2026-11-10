export const ROLE_NAMES = { user: 'Benutzer', raum_manager: 'Raum-Manager', admin: 'Administrator' };
export const roleName = (r) => ROLE_NAMES[r] || r || '';

// Anzeigename: nie eine E-Mail-Adresse als Name zeigen
export const displayName = (p) => {
  const n = String(p?.full_name || '').trim();
  return n && !n.includes('@') ? n : p?.username || 'Unbekannt';
};

export function timeAgo(iso, now = new Date()) {
  const d = new Date(iso); const s = Math.round((now - d) / 1000);
  if (s < 45) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `heute, ${t} Uhr`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `gestern, ${t} Uhr`;
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${t} Uhr`;
}

// Vorschlag für einen Benutzernamen aus dem Namen (z. B. "Jörg Müller" -> joerg.mueller)
export function suggestUsername(fullName) {
  const map = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
  const s = String(fullName || '').toLowerCase().replace(/[äöüß]/g, (c) => map[c]).replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return s.slice(0, 30);
}
