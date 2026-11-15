# WhatsApp-Anbindung einrichten (offizielle WhatsApp Business Cloud API)

**Was es kann:** Ausgewählte App-Chats werden mit WhatsApp-Rufnummern verbunden. Nachrichten laufen in beide Richtungen.
Mehrere Nummern an einem Chat ergeben einen Verteiler („Gruppe“): Jede Nachricht geht an alle anderen Teilnehmer, mit dem Absendernamen davor.

**Grenzen der offiziellen Schnittstelle**
- Bestehende WhatsApp-Gruppen lassen sich **nicht** anbinden (nur Einzelnummern, die die App als Verteiler bündelt).
- Frei schreiben darf die App einer Person nur **24 Stunden nach deren letzter Nachricht**. Danach wird die Nachricht in der App als „nicht zugestellt“ markiert. Abhilfe: von Meta genehmigte Vorlage (unten).
- Anhänge (Bilder, Sprachnachrichten, Dokumente) werden nicht übertragen; aus WhatsApp erscheint ein Hinweis „📎 Bild (nur in WhatsApp sichtbar)“.
- Personen müssen dem Erhalt zugestimmt haben (Meta-Richtlinie, Datenschutz).

## 1. Meta einrichten (einmalig, ca. 30 Min.)
1. <https://developers.facebook.com> → **Meine Apps → App erstellen** → Typ **Business** → Produkt **WhatsApp** hinzufügen.
2. Unter **WhatsApp → API-Einrichtung**: Eine Telefonnummer hinzufügen/verifizieren (eine Nummer, die nicht gleichzeitig in der normalen WhatsApp-App genutzt wird, oder die kostenlose Testnummer von Meta zum Ausprobieren).
3. Notieren: **Telefonnummer-ID** (`WHATSAPP_PHONE_NUMBER_ID`).
4. **App-Geheimschlüssel**: App-Einstellungen → Grundlegendes → „App-Geheimschlüssel“ (`WHATSAPP_APP_SECRET`).
5. **Dauerhaftes Token**: business.facebook.com → Einstellungen → Benutzer → **Systemnutzer** anlegen (Admin) → Assets: WhatsApp-Konto zuweisen → **Token generieren** mit den Berechtigungen `whatsapp_business_messaging` und `whatsapp_business_management` (`WHATSAPP_TOKEN`).
6. Testphase: Empfängernummern unter „API-Einrichtung → An“ als Testempfänger eintragen. Für den Echtbetrieb das Unternehmen verifizieren lassen.

## 2. Supabase: Secrets eintragen
Dashboard → Edge Functions → **Secrets**:

| Name | Wert |
|---|---|
| `WHATSAPP_TOKEN` | Token des Systemnutzers |
| `WHATSAPP_PHONE_NUMBER_ID` | Telefonnummer-ID |
| `WHATSAPP_APP_SECRET` | App-Geheimschlüssel |
| `WHATSAPP_VERIFY_TOKEN` | frei gewählter langer Zufallstext (nur für Schritt 3) |
| `WHATSAPP_TEMPLATE_NAME` | optional: Name der genehmigten Vorlage (siehe unten) |
| `WHATSAPP_TEMPLATE_LANG` | optional, Standard `de` |

## 3. Webhook bei Meta eintragen
WhatsApp → **Konfiguration → Webhook → Bearbeiten**:
- Callback-URL: `https://<PROJEKT-REF>.supabase.co/functions/v1/whatsapp-webhook`
- Verifizierungstoken: derselbe Text wie `WHATSAPP_VERIFY_TOKEN`
- Nach dem Verifizieren das Feld **messages** abonnieren.

## 4. In der App verbinden (nur Administratoren)
Chat → **💬 WhatsApp** → Name und Rufnummer (mit Ländervorwahl, z. B. `+49 151 2345678`) eintragen.
Oder: Chat → **+ Neuer Chat → Neuer WhatsApp-Chat**.
Verbinden und Trennen steht im Protokoll.

## Optional: Vorlage für Nachrichten nach Ablauf der 24 Stunden
Im WhatsApp Manager eine Vorlage der Kategorie *Utility* anlegen, Sprache Deutsch, Text z. B.:
`Neue Nachricht im Lager-Chat von {{1}}: {{2}}` → Name in `WHATSAPP_TEMPLATE_NAME` eintragen. Vorlagen kosten pro Zustellung.

## Technik
- Tabellen: `whatsapp_contacts`, `whatsapp_deliveries` (Migration `009_whatsapp.sql`). Rufnummern sieht nur der Administrator.
- Eingang: Edge Function `whatsapp-webhook` (Signaturprüfung, nur eingetragene Nummern, doppelte Zustellung wird ignoriert).
- Ausgang: Datenbank-Trigger (`supabase/setup/009_whatsapp_trigger.sql`) → Edge Function `whatsapp-send` (jede Zustellung genau einmal, nur frische Nachrichten).
- Tests: `npm test` und `npm run test:db`.
