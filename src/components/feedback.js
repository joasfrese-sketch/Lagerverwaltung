import { supabase, unwrap } from '../lib/supabase.js';
import { esc, toast, openModal, busy } from '../lib/ui.js';

const KINDS = [['problem', '🐞 Etwas funktioniert nicht'], ['idee', '💡 Idee / Wunsch'], ['lob', '👍 Das gefällt mir']];

// Rückmeldung an die Administratoren: landet in der Datenbank, Admins werden benachrichtigt
export function openFeedback(kind = 'idee') {
  const { el, close } = openModal(`
    <h3 class="mb-1 text-lg font-bold">Rückmeldung geben</h3>
    <p class="mb-3 text-sm text-slate-500">Was ist dir aufgefallen? Dein Hinweis geht direkt an die Administratoren.</p>
    <form id="f" class="space-y-3">
      <div><label class="label">Worum geht es?</label><select name="kind" class="input">${KINDS.map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label class="label">Deine Nachricht</label><textarea name="message" class="input h-28" required minlength="3" maxlength="2000" placeholder="Bitte beschreibe kurz, was du gemacht hast und was passiert ist."></textarea></div>
      <p class="text-xs text-slate-500">Die aktuelle Seite (${esc(location.hash || '#/')}) wird mitgeschickt, damit wir den Fehler finden.</p>
      <div class="flex justify-end gap-2"><button type="button" data-close class="btn-ghost">Abbrechen</button><button class="btn-primary">Senden</button></div>
    </form>`);
  el.querySelector('#f').onsubmit = (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    busy(e.target.querySelector('.btn-primary'), async () => {
      unwrap(await supabase.from('feedback').insert({ kind: f.get('kind'), message: String(f.get('message')).trim(), page: location.hash.slice(0, 200) }));
      close(); toast('Danke für deine Rückmeldung!', 'success');
    });
  };
}
