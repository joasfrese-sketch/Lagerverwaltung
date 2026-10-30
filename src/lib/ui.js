// Alle dynamischen Texte MÜSSEN durch esc() laufen (Schutz vor XSS).
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('de-DE') : '–');

// Wert für <input type="datetime-local"> in lokaler Zeit
export function toLocalInput(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function toast(message, type = 'info') {
  const colors = { info: 'bg-[#1e293b]', success: 'bg-brand-600', error: 'bg-red-600' };
  const el = document.createElement('div');
  el.className = `fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg ${colors[type] || colors.info}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// Einfaches Modal. Gibt { el, close } zurück; Inhalt als HTML-String.
export function openModal(html, { wide = false, onClose = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4';
  wrap.innerHTML = `<div class="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}">${html}</div>`;
  const close = () => { if (!wrap.isConnected) return; wrap.remove(); if (onClose) onClose(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.body.appendChild(wrap);
  return { el: wrap, close };
}

export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}
