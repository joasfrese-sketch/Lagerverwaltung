// Barrierefreiheit: Beschriftungen verknüpfen, Fokus in Dialogen halten, Hilfetexte für Symbol-Knöpfe.
let uid = 0;
const CONTROL = 'input:not([type=hidden]), select, textarea';

/** Verknüpft <label class="label"> mit dem zugehörigen Feld (for/id), wenn das noch nicht geschehen ist */
export function linkLabels(root = document) {
  root.querySelectorAll?.('label.label:not([for])').forEach((l) => {
    if (l.querySelector(CONTROL)) return; // Feld liegt schon im Label
    let ctl = null;
    for (let n = l.nextElementSibling; n && !ctl; n = null) ctl = n.matches?.(CONTROL) ? n : n.querySelector?.(CONTROL);
    if (!ctl && l.parentElement) ctl = l.parentElement.querySelector(CONTROL);
    if (!ctl) return;
    if (!ctl.id) ctl.id = `f${++uid}`;
    l.htmlFor = ctl.id;
  });
  // Symbol-Knöpfe ohne Text bekommen einen Namen
  root.querySelectorAll?.('button:not([aria-label])').forEach((b) => {
    const t = b.textContent.trim();
    if (t === '✕' || t === '×') b.setAttribute('aria-label', 'Schließen');
    else if (t === '←' && !b.title) b.setAttribute('aria-label', 'Zurück');
    else if (t === '→' && !b.title) b.setAttribute('aria-label', 'Weiter');
  });
}

/** Beobachtet die Seite und bringt neu eingefügte Inhalte in Ordnung */
export function watchA11y() {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; linkLabels(document); });
  }).observe(document.body, { childList: true, subtree: true });
  linkLabels(document);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Dialog zugänglich machen: Rolle, Fokus hinein, Tab bleibt im Dialog, Escape schließt, Fokus zurück */
export function makeDialog(wrap, box, close) {
  const previous = document.activeElement;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.tabIndex = -1;
  const title = box.querySelector('h3, h2'); if (title) { title.id ||= `dlg${++uid}`; box.setAttribute('aria-labelledby', title.id); }
  const onKey = (e) => {
    if (!wrap.isConnected) return document.removeEventListener('keydown', onKey, true);
    // nur der oberste Dialog reagiert
    const all = document.querySelectorAll('[data-dialog]'); if (all[all.length - 1] !== wrap) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) { e.preventDefault(); box.focus(); return; }
    const first = f[0]; const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  wrap.dataset.dialog = '1';
  document.addEventListener('keydown', onKey, true);
  queueMicrotask(() => { (box.querySelector('[autofocus]') || box.querySelector('input:not([type=hidden]), select, textarea') || box.querySelector('button') || box).focus({ preventScroll: true }); });
  return () => { document.removeEventListener('keydown', onKey, true); if (previous && previous.isConnected) { try { previous.focus({ preventScroll: true }); } catch { /* egal */ } } };
}
