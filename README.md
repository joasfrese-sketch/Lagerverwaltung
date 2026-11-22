# Lagerverwaltung Pro v3

Vite + Vanilla JS + Tailwind · Supabase (Auth, Postgres+RLS, Realtime, Edge Functions) · Vercel

## Einmalige Einrichtung (in dieser Reihenfolge)

### 1. Datenbank
SQL Editor → `supabase/migrations/001_schema.sql` komplett ausführen (**löscht das alte Schema**).
Hinweis `pg_cron`: Falls eine Notice erscheint, unter Database → Extensions `pg_cron` aktivieren und den Block „Zeitgesteuerte Erinnerungen" am Dateiende nochmals ausführen.

### 1b. Migration 002 (Artikel löschen & Sammel-Status)
SQL Editor → `supabase/migrations/002_item_management.sql` ausführen (wiederholbar, löscht keine Daten).

### 1c. Migration 003 (Artikelfotos)
SQL Editor → `supabase/migrations/003_item_photos.sql` ausführen (wiederholbar). Legt den Foto-Speicher `item-photos` und die Zugriffsregeln an. **Vor dem ersten Foto-Upload ausführen.**

### 1d. Migration 004 (Einladungs-Codes)
SQL Editor → `supabase/migrations/004_invites_security.sql` ausführen (wiederholbar). Ab dann ist die Registrierung nur mit Einladungs-Code möglich (deine Admin-E-Mail und vom Admin angelegte Konten sind ausgenommen). Danach die Edge Function **neu deployen**: `supabase functions deploy admin-create-user`.
Ersten Code erstellst du in der App: Einstellungen → Einladungs-Codes → „+ Code" → „Link kopieren" und weitergeben.

### 1e. Migration 005 (Frist verlängern, Warteliste, Sammel-Ausleihe)
SQL Editor → `supabase/migrations/005_extend_waitlist_bulk.sql` ausführen (wiederholbar, löscht keine Daten). Danach `supabase functions deploy send-push --no-verify-jwt` erneut ausführen (Link für Anträge).

### 1f. Migration 006 (Katalog-Sicht)
SQL Editor → `supabase/migrations/006_catalog_view.sql` ausführen (wiederholbar). **Vor dem Einspielen der neuen App ausführen**, denn Katalog, Filter und Suche lesen daraus.

### 1g. Migration 007 (Schadensfotos, Prüfintervalle, Änderungsprotokoll, Inventur, Kalender-Abo)
SQL Editor → `supabase/migrations/007_inspection_inventory_feed.sql` ausführen (wiederholbar, löscht keine Daten). Danach:
```
supabase functions deploy calendar-feed --no-verify-jwt
```
(Die Funktion liefert den abonnierbaren Kalender-Link; ohne sie zeigt „Abonnieren" einen Hinweis.)

### 1h. Migration 009 (Eskalation, Sicherung, Rückmeldungen, Fehlerbericht)
SQL Editor → `supabase/migrations/009_reminders_backup_feedback_monitoring.sql` ausführen (wiederholbar, löscht keine Daten). Aktiviert die nächtliche Sicherung (pg_cron), die Eskalation überfälliger Rückgaben, Rückmeldungen, Fehlerberichte und `ping()` für die Statusprüfung.

### 2. Auth (Supabase → Authentication)
- Providers → Email: **Confirm email = an**; Multi-Factor (TOTP) muss aktiviert sein (Standard) (Voraussetzung dafür, dass die Admin-Zuweisung per E-Mail sicher ist)
- URL Configuration: **Site URL** = Vercel-URL, **Redirect URLs** zusätzlich `http://localhost:5173`
- SMTP Settings → Custom SMTP (der Standardversand liefert nur an Team-Mitglieder und ist stark limitiert). Einfachste Variante mit Gmail:
  Google-Konto → 2-Faktor an → „App-Passwörter" → Passwort erzeugen; in Supabase: Host `smtp.gmail.com`, Port `465`, Benutzer `joas.frese@gmail.com`, Passwort = App-Passwort, Absender `joas.frese@gmail.com`.

### 3. Push-Schlüssel erzeugen (lokal, einmalig)
`npx web-push generate-vapid-keys` → öffentlicher + privater Schlüssel.

### 4. Edge Functions (Supabase CLI)
```
supabase login && supabase link --project-ref qqjtlcdqhyglhbcixvbr
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:joas.frese@gmail.com PUSH_WEBHOOK_SECRET=<zufälliger langer Text>
supabase functions deploy username-auth --no-verify-jwt
supabase functions deploy send-push --no-verify-jwt
supabase functions deploy admin-create-user
```
### 5. Database Webhook für Push
Dashboard → Database → Webhooks → neu: Tabelle `notifications`, Event **INSERT**, Typ „Supabase Edge Functions" → `send-push`, zusätzlicher Header `x-webhook-secret` = dein `PUSH_WEBHOOK_SECRET`.
Push erhält jeder Nutzer für seine eigenen Aktivitäten (Fristen, Ausleihen für ihn, Rückgabe-Bestätigungen durch Lagerwarte, Chat, Defekt-/Bestandsmeldungen für Verantwortliche). Eigene Aktionen lösen keinen Push aus.

### 6. Vercel
Repo verbinden (Framework Vite). Environment Variables (Production + Preview):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` (öffentlicher Schlüssel aus Schritt 3). Deploy.

### 7. Admin
`joas.frese@gmail.com` wird bei der Registrierung automatisch Administrator (E-Mail muss bestätigt werden, danach Login möglich).

## Testumgebung (Änderungen nicht direkt im Live-System)
Empfohlener Ablauf mit zwei getrennten Supabase-Projekten:

| | Live | Test |
|---|---|---|
| Supabase-Projekt | bestehendes Projekt | zweites, kostenloses Projekt (z. B. „lager-test") mit Testdaten |
| Vercel | **Production**-Umgebungsvariablen | **Preview**-Umgebungsvariablen zeigen auf das Test-Projekt |
| Git | Branch `main` | jeder andere Branch / Pull Request |

1. Im Test-Projekt dieselben Schritte 1–5 ausführen (Migrationen, Auth, Edge Functions).
2. Vercel → Settings → Environment Variables: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` für **Preview** auf das Test-Projekt setzen, für **Production** auf das Live-Projekt.
3. Neue Funktionen auf einem eigenen Branch entwickeln → Vercel baut automatisch eine Vorschau mit Testdaten → erst nach Prüfung in `main` übernehmen.
4. Neue Migrationen immer **zuerst im Test-Projekt** ausführen, dann im Live-Projekt.

## Automatische Tests
- `npm test` – Unit-Tests (Kalender, iCal, Inventur-Abgleich, Excel-Import, Anzeige-Helfer)
- `npm run test:db` – Datenbank-Tests: legt eine **leere lokale** Test-Datenbank an, spielt alle Migrationen ein und prüft die Kernabläufe (Ausleihe, Konflikt, Rückgabe, Rechte, Verlängerung, Entnahme, Protokoll, Prüfintervalle, Inventur, Kalender-Link). Benötigt ein lokales Postgres 16, z. B.:
  ```
  docker run -d --name lager-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:16
  PGHOST=localhost PGPORT=54329 PGUSER=postgres PGPASSWORD=postgres npm run test:db
  ```
  Das Skript verweigert die Ausführung gegen `*.supabase.co`.
- `npm run typecheck` – Typprüfung (JSDoc) der Kern-Module; `npm run test:e2e` – Browser-Tests (Playwright) gegen den Produktions-Build mit gefälschtem Backend, inkl. Barrierefreiheit (axe). Einmalig: `npx playwright install chromium`.
- GitHub Actions (`.github/workflows/ci.yml`) führt alles bei jedem Push und Pull Request aus; `uptime.yml` prüft alle 30 Min den Betrieb.

Betrieb, Sicherung, Wiederherstellung, Fehlersuche: siehe **[docs/BETRIEB.md](docs/BETRIEB.md)**.

## Lokal
`cp .env.example .env && npm install && npm run dev` (Service Worker/Push nur im Produktions-Build aktiv)

## Stand
Fertig: Schema+RLS+RPCs, Login (E-Mail/Benutzername), Registrierung mit Bestätigung, Passwort-Reset, Übersicht, Katalog (Räume, Suche, Ausleihe, Entnahme, Defekt/Freigabe, QR-Etikett), Kalender (Monat, Filter, Google/.ics), Chat (Gesamt/Gruppe/Direkt) + Benachrichtigungszentrale, Persönlicher Bereich (QR, Leihen, Rückgabe, eigener Kalender, Protokoll), Lagerwart-Terminal (Sammel-Abgabe, Drittperson, Protokoll), QR-Scanner, Einstellungen (Profil, Benachrichtigungen, Push, Passwort, Benutzer/Rollen/Berechtigungen), Fristen-Erinnerungen + Web-Push.
Paket 3: Manager-Dashboard auf der Übersicht, Katalogfilter und Sortierung, globale Suche (Strg+K). Paket 2: Frist verlängern (selbst bis 3 Tage, darüber Antrag mit Genehmigung), Warteliste („Benachrichtigen“), Sammel-Ausleihe für alle Nutzer. Paket 1: Registrierung per Einladungs-Code, Export (Excel/CSV), Protokoll-Seite mit Filtern, Zwei-Faktor-Anmeldung (2FA), einheitliche Icons, Profil-Einrichtung, Feinschliff. Davor: Artikelfotos (bis 5 pro Artikel, Titelbild, Galerie, automatische Verkleinerung), Auswahlmodus im Katalog (Alle auswählen, Bearbeiten, Status ändern, A4-Etiketten, Löschen mit Schutz für ausgeliehene Artikel), Excel/CSV-Import mit Spaltenzuordnung und Vorschau, Hell/Dunkel/Automatisch, Mehrfachscan (Ausgabe/Rücknahme) im Lagerwart-Terminal.
Paket 4: Schadensfotos bei der Rückgabe (bis 5, im Protokoll sichtbar), Wartungs-/Prüfintervalle mit Erinnerung und Dashboard-Kachel, Änderungsprotokoll für Artikel (ANGELEGT/GEÄNDERT mit alt → neu), Inventur-Modus (Raum scannen, Soll/Ist, Differenzliste als Excel/CSV/Druck, Verlauf), Kalender mit Monat/Woche/Liste und Farben pro Raum, abonnierbarer Kalender-Link (Google/Outlook/Apple), Vollsicherung als Excel (Admin), Offline-Lesemodus und Installationshinweis, automatische Tests + CI, Testumgebung.
Offen: Raum-Baukasten-UI.
