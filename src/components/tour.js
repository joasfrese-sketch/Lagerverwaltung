import { supabase } from '../lib/supabase.js';
import { esc, openModal } from '../lib/ui.js';
import { state } from '../state.js';

const STEPS = [
  { icon: '📦', title: 'Willkommen im Lager', text: 'Hier findest du alles, was der MBG Lemgo verleiht – nach Räumen sortiert. Tippe im Katalog auf einen Raum und suche oder filtere nach Artikeln.' },
  { icon: '📤', title: 'Ausleihen in zwei Schritten', text: 'Auf „Ausleihen“ tippen, Zeitraum per Schnellwahl (z. B. „Bis morgen 18 Uhr“) wählen, buchen – fertig. Der Belegungsplan zeigt, wann ein Artikel frei ist.' },
  { icon: '📷', title: 'Scannen statt suchen', text: 'Mit dem Kamera-Knopf scannst du die QR-Etiketten: Der Artikel öffnet sich direkt, bei Rückgabe genügt ein Scan.' },
  { icon: '🔔', title: 'Wir erinnern dich', text: 'Vor Ablauf der Frist und bei Überfälligkeit bekommst du eine Nachricht. Fristen kannst du unter „Meine Ausleihen“ verlängern.' },
  { icon: '💬', title: 'Fragen oder Ideen?', text: 'Unter „Mehr → Hilfe“ stehen die häufigsten Antworten. Und mit „Rückmeldung geben“ sagst du uns, was besser werden soll.' },
];

/** Zeigt die Einführung; onDone wird beim Beenden (auch beim Überspringen) gerufen */
export function openTour(onDone) {
  let i = 0;
  const { el, close } = openModal(`<div id="tour"></div>`, { onClose: () => onDone?.() });
  const draw = () => {
    const s = STEPS[i]; const last = i === STEPS.length - 1;
    el.querySelector('#tour').innerHTML = `
      <div class="text-center"><div class="text-5xl" aria-hidden="true">${s.icon}</div>
        <h3 class="mt-2 text-xl font-bold">${esc(s.title)}</h3>
        <p class="mx-auto mt-2 max-w-sm text-sm text-slate-600">${esc(s.text)}</p>
        <div class="mt-4 flex justify-center gap-1.5" aria-hidden="true">${STEPS.map((_, n) => `<i class="h-2 w-2 rounded-full ${n === i ? 'bg-brand-700' : 'bg-slate-300'}"></i>`).join('')}</div>
        <p class="sr-only">Schritt ${i + 1} von ${STEPS.length}</p>
        <div class="mt-5 flex gap-2"><button type="button" id="skip" class="btn-ghost flex-1">${last ? 'Zurück' : 'Überspringen'}</button><button type="button" id="next" class="btn-primary flex-[2]">${last ? 'Los geht’s' : 'Weiter'}</button></div></div>`;
    el.querySelector('#skip').onclick = () => (last ? (i--, draw()) : close());
    el.querySelector('#next').onclick = () => (last ? close() : (i++, draw()));
    el.querySelector('#next').focus();
  };
  draw();
}

/** Beim ersten Start einmalig zeigen (Merker in den Einstellungen des Nutzers) */
export async function maybeStartTour(prefs) {
  if (prefs?.tour_done || !prefs?.profile_done) return;
  openTour(async () => {
    try { await supabase.from('user_settings').upsert({ user_id: state.user.id, prefs: { ...prefs, tour_done: true } }); } catch { /* egal */ }
  });
}
