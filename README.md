# Lagerverwaltung Pro v3

Vite + Vanilla JS + Tailwind, Supabase (Auth, Postgres+RLS, Realtime), Hosting auf Vercel.

## Einrichtung
1. **Datenbank:** `supabase/migrations/001_schema.sql` im Supabase SQL Editor ausführen (löscht das alte Schema!).
2. **Auth-Einstellungen** (Supabase → Authentication): E-Mail-Bestätigung nach Wunsch an/aus; Site URL = Vercel-URL.
3. **Registrieren** (Benutzername + E-Mail), danach einmalig im SQL Editor:
   `update public.profiles set role = 'admin' where email = 'DEINE@MAIL';`
4. **Lokal:** `cp .env.example .env && npm install && npm run dev`
5. **Vercel:** Projekt `lagerverwaltung-mbg` → Environment Variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` setzen, Repo verbinden.
6. **Admin legt Nutzer an (später):** `supabase functions deploy admin-create-user`.
7. Optional Überfällig-Erinnerungen: pg_cron-Zeile am Ende der Migration (Kommentar) aktivieren.

## Stand
Fertig: Kalender (Monatsansicht, Filter, Google/.ics-Export), Schema+RLS, Login per E-Mail ODER Benutzername, Registrierung, App-Shell (Mobil/Desktop), Übersicht, Katalog (Räume, Suche, Ausleihe, Entnahme, Defekt/Freigabe, neuer Artikel), Persönlicher Bereich (QR, Leihen, Rückgabe, Protokoll).
Offen: Chat+Benachrichtigungszentrale, Einstellungen, Lagerwart-Terminal (Sammel-Abgabe, QR-Scan, Protokoll), Excel-Import, Nutzerverwaltung (UI), Fotos.
