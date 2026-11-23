# Betriebsanleitung – Lagerverwaltung MBG Lemgo

Diese Seite beantwortet: **Wo liegt was? Was tue ich bei Problemen? Wie sichere und stelle ich wieder her?**
Sie ist für Administratoren gedacht – ohne Programmierkenntnisse lesbar.

## 1. Wo liegt was?

| Teil | Ort | Wofür |
|---|---|---|
| App (Webseite) | **Vercel**, Projekt `lagerverwaltung-mbg` → https://lagerverwaltung-mbg.vercel.app | Oberfläche; wird bei jedem Push auf GitHub neu gebaut |
| Datenbank, Anmeldung, Fotos | **Supabase**, Projekt „Lagerverwaltung-MBG“ | Alle Daten (Artikel, Ausleihen, Protokoll, Nutzer) und Fotos |
| Code | **GitHub**, `joasfrese-sketch/Lagerverwaltung` | Quelltext, Migrationen, Tests |
| Server-Funktionen | Supabase → Edge Functions | `username-auth` (Anmeldung per Benutzername), `admin-create-user`, `admin-set-password`, `send-push`, `calendar-feed` |
| Zeitpläne | Supabase (pg_cron) | `lager-reminders` alle 30 Min (Erinnerungen), `lager-backup` täglich 02:15 (Sicherung), `lager-housekeeping` täglich 03:30 |
| Statusprüfung | GitHub Actions `Statusprüfung` | prüft alle 30 Min Webseite + Datenbank, bei Ausfall kommt eine E-Mail |

Geheimnisse (Schlüssel, Passwörter) stehen **nur** in den Einstellungen von Supabase/Vercel, nie im Code oder Chat.
Wichtig: Es gibt Zugänge zu Supabase, Vercel und GitHub. **Mindestens zwei Personen** sollten Administrator-Zugriff auf alle drei haben.

## 2. Nutzer verwalten
- **Neuen Nutzer anlegen:** App → Einstellungen → „Benutzer & Berechtigungen“ → „+ Benutzer“ (nur Administratoren).
- **Passwort neu setzen:** dort beim Nutzer „Passwort setzen“. Die Person sollte es danach selbst ändern.
- **Rolle ändern:** gleiche Seite (Benutzer / Raum-Manager / Administrator).

## 3. Sicherung und Wiederherstellung
**Automatisch:** Jede Nacht legt das System eine Sicherung an (14 Tage lückenlos, danach jeden Sonntag 12 Wochen lang).
Die App warnt Administratoren auf der Übersicht, wenn die letzte Sicherung älter als 2 Tage ist.

**Ansehen / manuell:** Einstellungen → „Betrieb & Sicherung“ → „Jetzt sichern“.

**Herunterladen (empfohlen, z. B. monatlich):** am gleichen Ort bei einer Sicherung „Herunterladen“ und die JSON-Datei an einem anderen Ort ablegen (Cloud-Speicher, USB-Stick). Eine Sicherung im selben System schützt nicht vor dem Verlust des ganzen Projekts.

**Wiederherstellen (versehentlich gelöscht):** „Gelöschtes zurückholen“ bei der passenden Sicherung. Es werden nur **gelöschte** Räume, Artikel, Ausleihen und Inventuren wieder angelegt; bestehende Daten werden nie überschrieben. Der Vorgang steht im Protokoll.
Fotos liegen separat im Supabase-Speicher (Buckets `item-photos`, `damage-photos`) und sind nicht Teil der Sicherung.

**Was tun, wenn das ganze Projekt verloren ist?** Neues Supabase-Projekt anlegen, Migrationen `supabase/migrations/001…009` der Reihe nach einspielen, Edge Functions deployen (siehe README), Vercel-Variablen anpassen. Daten aus einer heruntergeladenen Sicherung können Entwickler per SQL zurückspielen.

## 4. Protokoll aufräumen
Das Änderungsprotokoll wächst ständig. Einstellungen → „Betrieb & Sicherung“ → „Protokoll aufräumen“: Einträge älter als 6–36 Monate werden **zuerst als Excel-Datei gespeichert** und erst nach Bestätigung gelöscht. Einträge unter 90 Tagen sind nie löschbar.

## 5. Wenn etwas nicht geht
| Symptom | Prüfen |
|---|---|
| Seite lädt nicht | https://www.vercel-status.com, Vercel → Deployments (letzter Build grün?) |
| „Profil konnte nicht geladen werden“ / Fehler beim Speichern | Supabase → Project → ist es pausiert? (kostenloser Tarif pausiert bei Inaktivität; „Restore project“) |
| Anmeldung schlägt fehl | Supabase → Authentication → Logs; Edge Function `username-auth` in Logs ansehen |
| Keine E-Mails / „SMTP 535“ | Supabase → Authentication → SMTP Settings (App-Passwort des Absenders prüfen) |
| Keine Push-Nachrichten | Einstellungen → Benachrichtigungen; Edge Function `send-push` Logs; Secret `VAPID_PRIVATE_KEY` gesetzt? |
| Fehler bei Nutzern | Einstellungen → „Betrieb & Sicherung“ → „Fehlerberichte“ und „Rückmeldungen“ |
| Statusprüfung meldet Ausfall | GitHub → Actions → „Statusprüfung“ → Lauf ansehen, zeigt ob Webseite oder Datenbank betroffen ist |

**Rückgängig machen einer fehlerhaften Version:** Vercel → Deployments → frühere Version → „Promote to Production“.

## 6. Änderungen einspielen (für Entwickler)
1. Änderung auf einem Branch entwickeln; CI (`.github/workflows/ci.yml`) prüft Typen, Unit-Tests, Build, Browser-Tests und Datenbank-Tests.
2. Neue Migration `supabase/migrations/NNN_*.sql` – immer **wiederholbar** schreiben (`if not exists`, `create or replace`), mit Tests in `supabase/tests/10_core_flows.sql`.
3. Migration im Supabase SQL-Editor ausführen, dann deployen.
4. Pakete aktualisiert Dependabot wöchentlich als Pull Request (CI muss grün sein).

## 7. Aufbau des Codes (Kurzfassung)
- `src/lib/rules.js` – **alle** Regeln der Oberfläche (ausleihbar? überfällig? Konflikt? Verlängerung? Status?) als reine, getestete Funktionen. Maßgeblich bleibt die Datenbank.
- `src/lib/catalogData.js` – Datenzugriff des Katalogs; `src/lib/types.js` – Typbeschreibungen (JSDoc, `npm run typecheck`).
- `src/pages/*` – Seiten; `src/components/*` – Dialoge und wiederverwendbare Teile (`rentModals.js`, `itemCard.js`, `emptyState.js` …).
- `e2e/` – Browser-Tests mit gefälschtem Backend (`npm run test:e2e`), inkl. automatischer Barrierefreiheitsprüfung.
