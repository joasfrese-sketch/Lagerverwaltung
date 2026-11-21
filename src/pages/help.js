import { esc } from '../lib/ui.js';
import { openTour } from '../components/tour.js';
import { openFeedback } from '../components/feedback.js';
import { collapsible, bindCollapsibles } from '../components/collapse.js';

const FAQ = [
  ['Wie leihe ich etwas aus?', 'Katalog → Raum wählen → beim Artikel „Ausleihen“ tippen. Zeitraum wählen (Schnellwahl oder Kalender), dann „Verbindlich buchen“. Mehrere Artikel auf einmal: „Mehrere ausleihen“ oben im Raum.'],
  ['Wie gebe ich etwas zurück?', 'Unter „Meine Ausleihen“ auf „Zurückgeben“ tippen und die Vollständigkeit bestätigen. Ist etwas kaputt, „Defekt / Schaden melden“ ankreuzen und Fotos anhängen. Am Lagerterminal geht es auch per Scan.'],
  ['Der Artikel ist belegt – was nun?', 'Tippe auf „Benachrichtigen“. Sobald der Artikel frei wird, bekommst du eine Nachricht. Im Belegungsplan siehst du außerdem freie Zeiträume.'],
  ['Ich brauche länger. Was tun?', 'Unter „Meine Ausleihen“ → „Verlängern“. Bis 3 Tage geht es sofort, darüber (und bei überfälligen Ausleihen) fragt die App die Raum-Verantwortlichen.'],
  ['Wie funktioniert das Scannen?', 'Der Kamera-Knopf liest die QR-Etiketten der Artikel. Beim ersten Mal fragt der Browser nach der Kamera-Erlaubnis. Ohne Kamera kannst du den Code auch eintippen.'],
  ['Was bedeuten die Farben und Symbole?', '✅ Verfügbar · ⏳ Ausgeliehen · 🛠 Defekt / in Wartung · 📋 In Inventur · 📉 Bestand niedrig. Der farbige Rand der Karte zeigt dasselbe.'],
  ['Wie installiere ich die App?', 'Android/Chrome: Menü → „App installieren“. iPhone: Teilen-Symbol → „Zum Home-Bildschirm“. Danach startet die App wie jede andere und zeigt bei schlechtem Netz den letzten Stand.'],
  ['Passwort vergessen oder Anmeldung klappt nicht?', 'Auf der Anmeldeseite „Passwort vergessen“ wählen oder einen Administrator bitten, ein neues Passwort zu vergeben.'],
];

export async function render(el) {
  el.innerHTML = `<h1 class="mb-1 text-2xl font-bold">Hilfe</h1><p class="mb-4 text-sm text-slate-500">Antworten auf die häufigsten Fragen.</p>
    <div class="mb-4 flex flex-wrap gap-2"><button id="tour" class="btn-primary">▶️ Kurze Tour starten</button><button id="fb" class="btn-ghost">💬 Rückmeldung geben</button></div>
    <div class="space-y-3">${FAQ.map(([q, a], i) => collapsible({ id: 'faq-' + i, title: esc(q), body: `<p class="text-sm text-slate-700">${esc(a)}</p>` })).join('')}</div>`;
  bindCollapsibles(el);
  el.querySelector('#tour').onclick = () => openTour();
  el.querySelector('#fb').onclick = () => openFeedback('idee');
}
