// Passwörter: Erzeugen und einfache Prüfung (Mindestlänge wie bei Supabase, keine Allerweltsfolgen)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // ohne verwechselbare Zeichen (0/O, 1/l/I)
const TRIVIAL = ['12345678', '123456789', '1234567890', '0123456789', 'password', 'passwort', 'qwertzui', 'qwertyui', 'abcdefgh', 'lagerlager'];

export function generatePassword(length = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = '';
  for (const b of bytes) { if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length]; if (out.length === length) break; }
  return out;
}

// Liefert null, wenn das Passwort in Ordnung ist, sonst die Fehlermeldung
export function checkPassword(pw) {
  const s = String(pw ?? '');
  if (s.length < 8) return 'Das Passwort muss mindestens 8 Zeichen haben.';
  if (s.length > 72) return 'Das Passwort darf höchstens 72 Zeichen haben.';
  if (/^(.)\1+$/.test(s)) return 'Bitte nicht dasselbe Zeichen wiederholen.';
  if (TRIVIAL.includes(s.toLowerCase())) return 'Dieses Passwort ist zu einfach zu erraten.';
  if (/^\d+$/.test(s) && s.length < 12) return 'Nur Ziffern sind zu unsicher – bitte auch Buchstaben verwenden.';
  return null;
}
