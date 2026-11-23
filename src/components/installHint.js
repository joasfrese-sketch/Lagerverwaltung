import { esc } from '../lib/ui.js';

// „Zum Startbildschirm hinzufügen": Android/Chrome/Edge per Installations-Dialog, iPhone/iPad mit Anleitung
let deferred = null;
const OFF = 'install_hint_off';

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    window.dispatchEvent(new Event('install-available'));
  });
  window.addEventListener('appinstalled', () => { deferred = null; try { localStorage.setItem(OFF, '1'); } catch { /* egal */ } });
}

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIos = (ua = navigator.userAgent) => /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);

export function mountInstallHint(box) {
  if (!box) return;
  const off = () => { try { return localStorage.getItem(OFF) === '1'; } catch { return false; } };
  const draw = () => {
    if (!box.isConnected) return;
    if (isStandalone() || off() || (!deferred && !isIos())) { box.innerHTML = ''; return; }
    const ios = !deferred;
    box.innerHTML = `<section class="card flex flex-wrap items-center gap-3 !border-brand-500/40 !bg-brand-50">
      <div class="text-2xl">📲</div>
      <div class="min-w-0 flex-1 text-sm"><b>App auf dem Startbildschirm</b><div class="text-xs text-slate-600">${ios
        ? 'Tippe in Safari auf <b>Teilen</b> (Quadrat mit Pfeil) und dann auf <b>„Zum Home-Bildschirm"</b>. Danach startet die App im Vollbild, funktioniert bei schwachem Netz im Lesemodus und kann Push-Nachrichten empfangen.'
        : 'Schneller Start, Vollbild und Lesemodus bei schwachem Netz im Lager.'}</div></div>
      ${ios ? '' : '<button id="inst" class="btn-primary">Installieren</button>'}
      <button id="instOff" class="btn-ghost !px-2.5" aria-label="Hinweis ausblenden">${esc('✕')}</button></section>`;
    box.querySelector('#inst')?.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch { /* egal */ }
      deferred = null; draw();
    });
    box.querySelector('#instOff').onclick = () => { try { localStorage.setItem(OFF, '1'); } catch { /* egal */ } draw(); };
  };
  window.addEventListener('install-available', draw);
  draw();
}
