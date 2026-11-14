import { icon } from '../lib/icons.js';

// Hinweisleiste bei fehlender Verbindung (Lesemodus aus dem Zwischenspeicher)
export function mountOfflineBanner() {
  if (document.getElementById('offlineBar')) return;
  const bar = document.createElement('div');
  bar.id = 'offlineBar';
  bar.setAttribute('role', 'status');
  bar.className = 'fixed inset-x-0 top-0 z-[90] hidden items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-[#0f172a] shadow';
  bar.innerHTML = `${icon('wifiOff', 'h-4 w-4 shrink-0')}<span>Offline – Lesemodus: Anzeige aus dem Zwischenspeicher. Ausleihen und Änderungen sind erst wieder mit Verbindung möglich.</span>`;
  document.body.appendChild(bar);
  const update = () => { bar.classList.toggle('hidden', navigator.onLine); bar.classList.toggle('flex', !navigator.onLine); };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// Datenzwischenspeicher löschen (beim Abmelden, damit auf geteilten Geräten nichts zurückbleibt)
export async function clearOfflineData() {
  try { if ('caches' in window) await caches.delete('lager-api'); } catch { /* egal */ }
}
