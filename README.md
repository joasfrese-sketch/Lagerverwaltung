# Lagerverwaltung Pro v3

Vite + Vanilla JS + Tailwind · Supabase (Auth, Postgres+RLS, Realtime, Edge Functions) · Vercel

## Einmalige Einrichtung (in dieser Reihenfolge)

### 1. Datenbank
SQL Editor → `supabase/migrations/001_schema.sql` komplett ausführen (**löscht das alte Schema**).
Hinweis `pg_cron`: Falls eine Notice erscheint, unter Database → Extensions `pg_cron` aktivieren und den Block „Zeitgesteuerte Erinnerungen" am Dateiende nochmals ausführen.

### 2. Auth (Supabase → Authentication)
- Providers → Email: **Confirm email = an** (Voraussetzung dafür, dass die Admin-Zuweisung per E-Mail sicher ist)
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

## Lokal
`cp .env.example .env && npm install && npm run dev` (Service Worker/Push nur im Produktions-Build aktiv)

## Stand
Fertig: Schema+RLS+RPCs, Login (E-Mail/Benutzername), Registrierung mit Bestätigung, Passwort-Reset, Übersicht, Katalog (Räume, Suche, Ausleihe, Entnahme, Defekt/Freigabe, QR-Etikett), Kalender (Monat, Filter, Google/.ics), Chat (Gesamt/Gruppe/Direkt) + Benachrichtigungszentrale, Persönlicher Bereich (QR, Leihen, Rückgabe, eigener Kalender, Protokoll), Lagerwart-Terminal (Sammel-Abgabe, Drittperson, Protokoll), QR-Scanner, Einstellungen (Profil, Benachrichtigungen, Push, Passwort, Benutzer/Rollen/Berechtigungen), Fristen-Erinnerungen + Web-Push.
Offen: Wochen-/Listenansicht, Excel-Import, Fotos, A4-Sammeldruck, Raum-Baukasten-UI.
