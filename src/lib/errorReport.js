import { supabase } from './supabase.js';
import { state } from '../state.js';

// Meldet unerwartete Fehler der App (nicht Eingabefehler) an die Datenbank, damit Administratoren sie sehen.
// Gedrosselt: höchstens 5 Meldungen pro Sitzung, gleiche Fehler nur einmal. Fehler beim Melden werden verschluckt.
const seen = new Set(); let sent = 0;
const IGNORE = /ResizeObserver|Script error|Failed to fetch|NetworkError|Load failed|AbortError|WebSocket|realtime/i;

export async function reportError(message, stack = '') {
  try {
    const msg = String(message || '').slice(0, 500);
    if (!state.user || !msg || IGNORE.test(msg) || seen.has(msg) || sent >= 5) return;
    seen.add(msg); sent++;
    await supabase.from('client_errors').insert({ message: msg, stack: String(stack || '').slice(0, 4000), page: location.hash.slice(0, 200), agent: navigator.userAgent.slice(0, 300) });
  } catch { /* Melden darf nie selbst Fehler auslösen */ }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.message, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason?.message || String(e.reason), e.reason?.stack));
}
