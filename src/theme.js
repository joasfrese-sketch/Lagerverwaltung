// Bildschirmmodus: 'light' | 'dark' | 'auto' (folgt dem Gerät)
const KEY = 'theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

export const getTheme = () => localStorage.getItem(KEY) || 'auto';

export function applyTheme() {
  const t = getTheme();
  const dark = t === 'dark' || (t === 'auto' && mq.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f172a' : '#059669');
}

export function setTheme(t) {
  localStorage.setItem(KEY, ['light', 'dark', 'auto'].includes(t) ? t : 'auto');
  applyTheme();
}

if (mq.addEventListener) mq.addEventListener('change', () => { if (getTheme() === 'auto') applyTheme(); });
