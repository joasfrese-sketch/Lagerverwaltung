-- =====================================================================
-- Automatische Tests der Kernabläufe: Ausleihe, Konflikt, Rückgabe, Rechte,
-- Verlängerung, Entnahme, Änderungsprotokoll, Prüfintervalle, Inventur, Kalender-Link.
-- Läuft gegen eine Test-Datenbank (scripts/test-db.sh) – NIE gegen das Live-System.
-- Jede fehlgeschlagene Prüfung bricht mit einer Fehlermeldung ab.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;
\o /dev/null

create schema if not exists tests;
grant usage on schema tests to authenticated, service_role;

create or replace function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FEHLGESCHLAGEN: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

-- erwartet, dass p_sql mit einer Meldung scheitert, die p_pattern enthält (Groß-/Kleinschreibung egal)
create or replace function tests.throws(p_sql text, p_pattern text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_pattern || '%' then raise notice 'ok - %', p_msg; return; end if;
    raise exception 'FEHLGESCHLAGEN: % (falsche Meldung: %)', p_msg, sqlerrm;
  end;
  raise exception 'FEHLGESCHLAGEN: % (kein Fehler ausgelöst)', p_msg;
end $$;

create or replace function tests.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
$$;
grant execute on all functions in schema tests to authenticated, service_role;

-- ---------- Testdaten (als Datenbank-Besitzer) ----------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local',   '{"full_name":"Ada Admin","username":"ada"}',     '{"admin_created":true}'),
  ('00000000-0000-0000-0000-0000000000b1', 'manager@test.local', '{"full_name":"Max Manager","username":"max"}',   '{"admin_created":true}'),
  ('00000000-0000-0000-0000-0000000000c1', 'user1@test.local',   '{"full_name":"Uta Nutzer","username":"uta"}',    '{"admin_created":true}'),
  ('00000000-0000-0000-0000-0000000000c2', 'user2@test.local',   '{"full_name":"Udo Nutzer","username":"udo"}',    '{"admin_created":true}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'raum_manager', managed_room = 'Technik' where id = '00000000-0000-0000-0000-0000000000b1';

-- Registrierung ohne Einladungs-Code wird abgelehnt
select tests.throws($$insert into auth.users (email) values ('fremd@test.local')$$, 'Einladungs-Code', 'Registrierung ohne Einladungs-Code wird abgelehnt');

insert into public.items (id, name, room_id, item_type, stock_quantity, min_stock, required_permission, inspection_interval_months) values
  ('T-CAM',    'Kamera',      'Technik', 'standard',   1, 0, null,   null),
  ('T-MIC',    'Funkmikrofon','Technik', 'standard',   1, 0, 'Ton',  null),
  ('T-DRILL',  'Bohrmaschine','Technik', 'standard',   1, 0, null,   12),
  ('B-PAPIER', 'Druckerpapier','Büro',   'consumable', 5, 2, null,   null);

-- ======================= Ausleihe & Konflikt =======================
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok(public.rent_item('T-CAM', now() + interval '1 day', now() + interval '2 days', 'Sommerfest') is not null, 'Nutzer kann einen freien Artikel ausleihen');
select tests.ok((select count(*) from public.rentals) = 1, 'Nutzer sieht seine eigene Ausleihe');
select tests.throws($$select public.rent_item('T-CAM', now() + interval '25 hours', now() + interval '3 days')$$, 'bereits belegt', 'Überschneidende Buchung desselben Nutzers wird abgelehnt');
select tests.throws($$select public.rent_item('T-CAM', now() + interval '1 day', now() + interval '2 days', null, '00000000-0000-0000-0000-0000000000c2')$$, 'Nur Raum-Manager', 'Nutzer darf nicht für andere ausleihen');
select tests.throws($$select public.rent_item('T-MIC', now() + interval '1 day', now() + interval '2 days')$$, 'Berechtigung', 'Fehlende Berechtigung verhindert die Ausleihe');
select tests.throws($$select public.rent_item('B-PAPIER', now(), now() + interval '1 day')$$, 'Verbrauchsmaterial', 'Verbrauchsmaterial kann nicht ausgeliehen werden');
select tests.throws($$select public.rent_item('T-CAM', now() + interval '5 days', now() + interval '4 days')$$, 'nach dem Beginn', 'Rückgabe vor Beginn wird abgelehnt');

select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.throws($$select public.rent_item('T-CAM', now() + interval '36 hours', now() + interval '3 days')$$, 'bereits belegt', 'Konflikt mit fremder Buchung wird abgelehnt');
select tests.ok(public.rent_item('T-CAM', now() + interval '2 days', now() + interval '3 days') is not null, 'Anschlussbuchung direkt danach ist erlaubt');
select tests.ok((select count(*) from public.rentals) = 1, 'Nutzer 2 sieht nur seine eigene Ausleihe (RLS)');
select tests.ok((select count(*) from public.rental_calendar where borrower_name is not null) = 1, 'Belegungsplan zeigt fremde Ausleiher nicht an');
select tests.ok((select count(*) from public.rental_calendar) = 2, 'Belegungsplan zeigt aber beide Belegungen');

-- ======================= Rechte auf Artikel =======================
update public.items set name = 'Gehackt' where id = 'T-CAM';
select tests.ok((select name from public.items where id = 'T-CAM') = 'Kamera', 'Nutzer kann Artikel nicht ändern (RLS)');
select tests.throws($$insert into public.items (name, room_id) values ('Neu', 'Technik')$$, 'row-level security', 'Nutzer kann keine Artikel anlegen');
select tests.throws($$select public.set_item_status('T-CAM', 'maintenance')$$, 'Keine Berechtigung', 'Nutzer kann den Status nicht ändern');
select tests.throws($$select public.create_invite()$$, 'Nur Administratoren', 'Nutzer kann keine Einladungs-Codes erzeugen');
select tests.throws($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c2'$$, 'Keine Berechtigung', 'Nutzer kann sich nicht selbst zum Admin machen');
reset role;

-- ======================= Rückgabe =======================
select set_config('tests.r1', (select id from public.rentals where borrower_id = '00000000-0000-0000-0000-0000000000c1' limit 1)::text, false);
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.throws($$select public.return_rentals(array[current_setting('tests.r1')]::uuid[])$$, 'Keine Berechtigung', 'Fremde Ausleihe kann nicht zurückgegeben werden');
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok(public.return_rentals((select array_agg(id) from public.rentals), null, 'ok', 'Display gesprungen',
  '["https://x.supabase.co/storage/v1/object/public/damage-photos/00000000-0000-0000-0000-0000000000c1/a.jpg"]') = 1, 'Nutzer gibt eigene Ausleihe mit Schadensmeldung und Foto zurück');
reset role;
select tests.ok((select status from public.items where id = 'T-CAM') = 'maintenance', 'Defekt-Meldung setzt Artikel auf Wartung');
select tests.ok((select jsonb_array_length(damage_photos) from public.rentals where borrower_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'Schadensfoto wird an der Ausleihe gespeichert');
select tests.ok(exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and type = 'damage'), 'Raum-Manager wird über den Defekt benachrichtigt');
select tests.ok(exists (select 1 from public.activity_log where action = 'DEFEKT' and item_id = 'T-CAM'), 'Defekt steht im Protokoll');
select tests.throws($$update public.rentals set damage_photos = '[1,2,3,4,5,6]' where item_id = 'T-CAM'$$, 'damage_photos_max5', 'Höchstens 5 Schadensfotos');

set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.throws($$select public.rent_item('T-CAM', now() + interval '10 days', now() + interval '11 days')$$, 'nicht ausleihbar', 'Defekter Artikel kann nicht ausgeliehen werden');

-- ======================= Raum-Manager =======================
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select public.set_item_status('T-CAM', 'active');
select tests.ok((select status from public.items where id = 'T-CAM') = 'active', 'Raum-Manager gibt Artikel seines Raums frei');
select tests.ok(public.rent_item('T-MIC', now(), now() + interval '2 days', null, '00000000-0000-0000-0000-0000000000c1') is not null, 'Raum-Manager kann für andere ausleihen (auch ohne deren Berechtigung)');
select tests.throws($$select public.set_item_status('B-PAPIER', 'maintenance')$$, 'Keine Berechtigung', 'Raum-Manager darf fremde Räume nicht ändern');
update public.items set shelf = 'Regal A' where id = 'B-PAPIER';
select tests.ok((select shelf from public.items where id = 'B-PAPIER') is null, 'Raum-Manager kann Artikel fremder Räume nicht bearbeiten');
update public.items set shelf = 'Regal T', min_stock = 1 where id = 'T-CAM';
reset role;
select tests.ok((select details -> 'changes' ? 'shelf' from public.activity_log where action = 'GEÄNDERT' and item_id = 'T-CAM' order by created_at desc limit 1), 'Bearbeitung wird mit geänderten Feldern protokolliert');
select tests.ok((select actor_id from public.activity_log where action = 'GEÄNDERT' and item_id = 'T-CAM' order by created_at desc limit 1) = '00000000-0000-0000-0000-0000000000b1', 'Protokoll nennt, wer geändert hat');
select tests.ok(exists (select 1 from public.activity_log where action = 'ANGELEGT' and item_id = 'T-DRILL'), 'Anlegen eines Artikels wird protokolliert');

-- ======================= Entnahme =======================
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok(public.consume_item('B-PAPIER', 4, 'Flyer') = 1, 'Entnahme reduziert den Bestand');
select tests.throws($$select public.consume_item('B-PAPIER', 2)$$, 'Nur noch 1', 'Entnahme über den Bestand hinaus wird abgelehnt');
reset role;
select tests.ok(not exists (select 1 from public.activity_log where action = 'GEÄNDERT' and item_id = 'B-PAPIER'), 'Entnahme erzeugt keinen zusätzlichen GEÄNDERT-Eintrag');
select tests.ok(exists (select 1 from public.notifications where type = 'stock' and user_id = '00000000-0000-0000-0000-0000000000a1'), 'Niedriger Bestand benachrichtigt den Admin');

-- ======================= Verlängerung =======================
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok(public.extend_rental((select id from public.rentals where status = 'active' limit 1), now() + interval '4 days') = 'extended', 'Kurze Verlängerung (bis 3 Tage) geht sofort');
select tests.throws(format('select public.extend_rental(%L, now() + interval ''20 days'')', (select id from public.rentals where status = 'active' limit 1)), 'Grund', 'Lange Verlängerung braucht einen Grund');
select tests.ok(public.extend_rental((select id from public.rentals where status = 'active' limit 1), now() + interval '20 days', 'Projekt dauert länger') = 'requested', 'Lange Verlängerung wird als Antrag gestellt');
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select public.decide_extension((select id from public.extension_requests where status = 'pending' limit 1), true);
reset role;
select tests.ok((select end_at from public.rentals where borrower_id = '00000000-0000-0000-0000-0000000000c2' and status = 'active') > now() + interval '19 days', 'Raum-Manager genehmigt den Antrag');

-- ======================= Überfällig blockiert =======================
insert into public.rentals (item_id, borrower_id, start_at, end_at) values ('T-DRILL', '00000000-0000-0000-0000-0000000000c2', now() - interval '3 days', now() - interval '1 day');
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.throws($$select public.rent_item('T-DRILL', now() + interval '1 day', now() + interval '2 days')$$, 'überfällig', 'Überfälliger Artikel kann nicht neu gebucht werden');
reset role;
update public.rentals set status = 'returned', returned_at = now() where item_id = 'T-DRILL';

-- ======================= Prüfintervalle =======================
select tests.ok((select next_inspection_at::date from public.items where id = 'T-DRILL') = ((select created_at from public.items where id = 'T-DRILL') + interval '12 months')::date, 'Nächste Prüfung = Anlage + Intervall');
update public.items set last_inspection_at = now() - interval '13 months' where id = 'T-DRILL';
select tests.ok((select inspection_due from public.catalog_items where id = 'T-DRILL'), 'Überfällige Prüfung wird im Katalog als fällig markiert');
select tests.ok(public.run_reminders() >= 1, 'Erinnerungslauf erzeugt Prüf-Erinnerungen');
select tests.ok(exists (select 1 from public.notifications where link like 'insp:T-DRILL:%' and user_id = '00000000-0000-0000-0000-0000000000b1'), 'Raum-Manager erhält die Prüf-Erinnerung');
select public.run_reminders();
select tests.ok((select count(*) from public.notifications where link like 'insp:T-DRILL:%' and user_id = '00000000-0000-0000-0000-0000000000b1') = 1, 'Prüf-Erinnerung wird nicht wiederholt');
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.throws($$select public.record_inspection('T-DRILL')$$, 'Keine Berechtigung', 'Nutzer kann keine Prüfung eintragen');
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select tests.ok(public.record_inspection('T-DRILL', true, 'VDE ok') > now() + interval '11 months', 'Bestandene Prüfung setzt die nächste Frist');
select public.record_inspection('T-DRILL', false, 'Kabel beschädigt');
reset role;
select tests.ok((select status from public.items where id = 'T-DRILL') = 'maintenance', 'Nicht bestandene Prüfung sperrt den Artikel');
select tests.ok((select count(*) from public.activity_log where action = 'PRÜFUNG') = 2, 'Prüfungen stehen im Protokoll');

-- ======================= Inventur =======================
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.throws($$select public.save_inventory('Technik', array['T-CAM'])$$, 'Keine Berechtigung', 'Nutzer kann keine Inventur speichern');
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select set_config('tests.inv', public.save_inventory('Technik', array['T-CAM', 'B-PAPIER', 'GIBTSNICHT', 'T-CAM', ' '], 'Jahresinventur', true)::text, false);
reset role;
select tests.ok((current_setting('tests.inv')::jsonb ->> 'found')::int = 1, 'Inventur: gefundene Artikel');
select tests.ok((select array_agg(m ->> 'id' order by m ->> 'id') from jsonb_array_elements(current_setting('tests.inv')::jsonb -> 'missing') m) = array['T-DRILL'], 'Inventur: fehlende Artikel (ausgeliehene zählen nicht als fehlend)');
select tests.ok((current_setting('tests.inv')::jsonb -> 'rented' -> 0 ->> 'id') = 'T-MIC', 'Inventur: ausgeliehene Artikel werden separat gelistet');
select tests.ok((current_setting('tests.inv')::jsonb -> 'unexpected' -> 0 ->> 'id') = 'B-PAPIER', 'Inventur: Artikel aus anderem Raum erkannt');
select tests.ok((current_setting('tests.inv')::jsonb -> 'unknown') = '["GIBTSNICHT"]', 'Inventur: unbekannte Codes erkannt');
select tests.ok((select status from public.items where id = 'T-DRILL') = 'maintenance', 'Inventur ändert nur aktive Artikel auf „In Inventur"');
select tests.ok(exists (select 1 from public.activity_log where action = 'INVENTUR'), 'Inventur steht im Protokoll');

-- ======================= Kalender-Link =======================
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select set_config('tests.tok_user', public.calendar_feed_token(), false);
select tests.ok(public.calendar_feed_token() = current_setting('tests.tok_user'), 'Kalender-Link bleibt stabil');
select tests.throws(format('select * from public.calendar_feed_events(%L)', current_setting('tests.tok_user')), 'permission denied', 'Kalender-Daten nur über die Edge Function abrufbar');
select tests.as_user('00000000-0000-0000-0000-0000000000b1');
select set_config('tests.tok_mgr', public.calendar_feed_token(), false);
reset role;
set role service_role;
select tests.ok((select bool_and(own) and count(*) = 2 from public.calendar_feed_events(current_setting('tests.tok_user'))), 'Feed des Nutzers enthält nur eigene Ausleihen');
select tests.ok((select count(*) from public.calendar_feed_events(current_setting('tests.tok_mgr'))) >= 4, 'Feed des Raum-Managers enthält die Buchungen seines Raums');
select tests.ok((select count(*) from public.calendar_feed_events('falsch')) = 0, 'Ungültiger Link liefert nichts');
reset role;
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok(public.calendar_feed_token(true) <> current_setting('tests.tok_user'), 'Kalender-Link kann zurückgesetzt werden');
reset role;


-- ======================= WhatsApp-Anbindung =======================
select tests.ok(public.wa_normalize_phone('+49 (151) 234-567 89') = '4915123456789', 'Rufnummer wird normalisiert (+49 …)');
select tests.ok(public.wa_normalize_phone('0049 151 23456789') = '4915123456789', 'Rufnummer mit 00 am Anfang');
select tests.throws($$select public.wa_normalize_phone('0151 23456789')$$, 'Ländervorwahl', 'Nummer ohne Ländervorwahl wird abgelehnt');
select tests.throws($$select public.wa_normalize_phone('+49 12')$$, 'Länge', 'Zu kurze Nummer wird abgelehnt');
select tests.throws($$select public.wa_normalize_phone('+49abc12345678')$$, 'Ziffern', 'Buchstaben in der Nummer werden abgelehnt');

set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.throws($$select public.whatsapp_create_chat('X', 'Y', '+4915111111111')$$, 'Nur Administratoren', 'Nutzer kann keinen WhatsApp-Chat anlegen');
select tests.throws($$select public.whatsapp_add_contact('00000000-0000-0000-0000-0000000000c1', 'Y', '+4915111111111')$$, 'Nur Administratoren', 'Nutzer kann keine Rufnummer verbinden');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select set_config('tests.wachat', public.whatsapp_create_chat('Gemeinde-Helfer', 'Anna', '+49 151 11111111')::text, false);
select public.whatsapp_add_contact(current_setting('tests.wachat')::uuid, 'Ben', '+49 152 22222222');
select tests.ok((select count(*) from public.whatsapp_contacts where chat_id = current_setting('tests.wachat')::uuid) = 2, 'Admin verbindet zwei Rufnummern mit einem Chat (Verteiler)');
select tests.throws(format('select public.whatsapp_add_contact(%L, ''Z'', ''0151 5555555'')', current_setting('tests.wachat')), 'Ländervorwahl', 'Verbinden prüft die Rufnummer');
select tests.ok((select count(*) from public.whatsapp_bridged_chats() where n = 2) = 1, 'Mitglied sieht, dass der Chat verbunden ist');
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok((select count(*) from public.whatsapp_contacts) = 0, 'Normale Nutzer sehen keine Rufnummern (RLS)');
select tests.ok((select count(*) from public.whatsapp_bridged_chats()) = 0, 'Nicht-Mitglieder sehen verbundene Chats nicht');
select tests.throws($$select public.whatsapp_ingest('4915111111111', 'x', 'hi', 'w1')$$, 'permission denied', 'Nutzer kann keine WhatsApp-Nachricht einschleusen');
select tests.throws($$select * from public.whatsapp_outbound('00000000-0000-0000-0000-0000000000c1')$$, 'permission denied', 'Nutzer kann den Versand nicht auslösen');
reset role;

-- Eingehend (Edge Function mit service_role)
set role service_role;
select tests.ok(public.whatsapp_ingest('4915111111111', 'Anna Profil', 'Hallo Team', 'wamid.1') = 1, 'Eingehende WhatsApp-Nachricht landet im Chat');
select tests.ok(public.whatsapp_ingest('4915111111111', 'Anna Profil', 'Hallo Team', 'wamid.1') = 0, 'Doppelte Zustellung (gleiche ID) wird ignoriert');
select tests.ok(public.whatsapp_ingest('4999999999999', 'Fremd', 'Spam', 'wamid.9') = 0, 'Unbekannte Rufnummer wird ignoriert');
reset role;
select tests.ok((select count(*) from public.chat_messages where source = 'whatsapp' and chat_id = current_setting('tests.wachat')::uuid) = 1, 'Genau eine WhatsApp-Nachricht gespeichert');
select tests.ok((select sender_id is null and wa_name = 'Anna' from public.chat_messages where wa_message_id = 'wamid.1'), 'Absender ist die WhatsApp-Person (Name aus der Kontaktliste)');
select tests.ok(exists (select 1 from public.notifications where link = 'chat:' || current_setting('tests.wachat') and user_id = '00000000-0000-0000-0000-0000000000a1' and title like 'Anna (WhatsApp)%'), 'App-Mitglieder werden über WhatsApp-Nachrichten benachrichtigt');
select tests.ok((select last_inbound_at is not null from public.whatsapp_contacts where phone = '4915111111111' limit 1), '24-Stunden-Fenster wird vermerkt');

-- Ausgehend: App-Nachricht an alle Rufnummern; WhatsApp-Nachricht nur an die ANDEREN (Verteiler)
insert into public.chat_messages (chat_id, sender_id, body) values (current_setting('tests.wachat')::uuid, '00000000-0000-0000-0000-0000000000a1', 'Antwort aus der App');
select set_config('tests.m_app', (select id::text from public.chat_messages where body = 'Antwort aus der App'), false);
set role service_role;
select set_config('tests.out1', (select count(*)::text || '|' || string_agg(phone || '=' || in_window::text, ',' order by phone) from public.whatsapp_outbound(current_setting('tests.m_app')::uuid)), false);
select set_config('tests.out2', (select count(*)::text from public.whatsapp_outbound(current_setting('tests.m_app')::uuid)), false);
reset role;
select tests.ok(split_part(current_setting('tests.out1'), '|', 1) = '2', 'App-Nachricht wird für beide Rufnummern zum Versand reserviert');
select tests.ok(split_part(current_setting('tests.out1'), '|', 2) = '4915111111111=true,4915222222222=false', '24-Stunden-Fenster: nur wer kürzlich geschrieben hat, bekommt freien Text');
select tests.ok(current_setting('tests.out2') = '0', 'Erneuter Aufruf versendet nichts doppelt');
select tests.ok((select count(*) from public.whatsapp_deliveries d join public.whatsapp_contacts c on c.id = d.contact_id where d.message_id = current_setting('tests.m_app')::uuid and c.phone = '4915111111111') = 1, 'Zustellung ist je Rufnummer vermerkt');
select set_config('tests.m_wa', (select id::text from public.chat_messages where wa_message_id = 'wamid.1'), false);
set role service_role;
select set_config('tests.wa_to', (select string_agg(phone, ',') from public.whatsapp_outbound(current_setting('tests.m_wa')::uuid)), false);
select public.whatsapp_set_delivery((select id from public.whatsapp_deliveries where message_id = current_setting('tests.m_app')::uuid limit 1), 'failed', 'Fenster zu');
reset role;
select tests.ok(current_setting('tests.wa_to') = '4915222222222', 'WhatsApp-Nachricht geht an die anderen Teilnehmer, nicht an den Absender zurück');
select tests.ok((select count(*) from public.whatsapp_deliveries where status = 'failed' and error = 'Fenster zu') = 1, 'Fehlerstatus wird gespeichert');

-- Sichtbarkeit des Zustellstatus nur für Chat-Mitglieder
insert into public.chat_members (chat_id, user_id) values (current_setting('tests.wachat')::uuid, '00000000-0000-0000-0000-0000000000c2');
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.ok((select count(*) from public.whatsapp_deliveries) >= 3, 'Chat-Mitglied sieht den Zustellstatus');
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok((select count(*) from public.whatsapp_deliveries) = 0, 'Nicht-Mitglied sieht keinen Zustellstatus');
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select public.whatsapp_remove_contact((select id from public.whatsapp_contacts where phone = '4915222222222' limit 1));
select tests.ok((select count(*) from public.whatsapp_contacts) = 1, 'Admin kann eine Rufnummer trennen');
reset role;
select tests.ok((select count(*) from public.activity_log where action = 'WHATSAPP') >= 3, 'Verbinden/Trennen steht im Protokoll');


-- ======================= WhatsApp für Mitglieder (Nummer im Profil) =======================
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.throws($$update public.profiles set phone = '4915100000001' where id = '00000000-0000-0000-0000-0000000000c1'$$, 'Einstellungen', 'Nutzer kann die Rufnummer nicht direkt ändern');
select tests.throws($$update public.profiles set whatsapp_verified_at = now() where id = '00000000-0000-0000-0000-0000000000c1'$$, 'Einstellungen', 'Nutzer kann sich nicht selbst als bestätigt markieren');
select tests.throws($$select public.set_my_whatsapp('0151 1234567', true)$$, 'Ländervorwahl', 'Nummer im Profil wird geprüft');
select set_config('tests.set1', public.set_my_whatsapp('+49 151 30000001', true)::text, false);
select tests.ok((current_setting('tests.set1')::jsonb ->> 'status') = 'pending' and length(current_setting('tests.set1')::jsonb ->> 'code') = 6, 'Nummer gespeichert, wartet auf Bestätigung mit 6-stelligem Code');
select tests.as_user('00000000-0000-0000-0000-0000000000c2');
select tests.throws($$select public.set_my_whatsapp('+49 151 30000001', true)$$, 'bereits', 'Eine Rufnummer gehört nur zu einem Konto');
reset role;
select set_config('tests.code1', (select wa_verify_code from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), false);

-- unbestätigt: keine Weiterleitung
insert into public.chat_messages (chat_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Hallo alle');
select set_config('tests.mg1', (select id::text from public.chat_messages where body = 'Hallo alle'), false);
set role service_role;
select set_config('tests.o1', (select count(*)::text from public.whatsapp_outbound(current_setting('tests.mg1')::uuid)), false);
reset role;
select tests.ok(current_setting('tests.o1') = '0', 'Unbestätigte Nummer bekommt keine Nachrichten');

-- Bestätigung per WhatsApp
set role service_role;
select set_config('tests.v0', public.whatsapp_handle_inbound('4915130000001', 'Uta', 'VERBINDEN ZZZZZZ', 'v0')::text, false);
reset role;
select tests.ok((current_setting('tests.v0')::jsonb ->> 'kind') = 'ignored' and (select whatsapp_verified_at is null from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'Falscher Code bestätigt nichts');
set role service_role;
select set_config('tests.v1', public.whatsapp_handle_inbound('4915130000001', 'Uta', '  verbinden ' || lower(current_setting('tests.code1')) || ' ', 'v1')::text, false);
select set_config('tests.v2', public.whatsapp_handle_inbound('4915199999999', 'Fremd', 'VERBINDEN ' || current_setting('tests.code1'), 'v2')::text, false);
reset role;
select tests.ok((current_setting('tests.v1')::jsonb ->> 'kind') = 'verified' and (select whatsapp_verified_at is not null and wa_verify_code is null from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'Richtiger Code (von der eigenen Nummer) bestätigt die Nummer');
select tests.ok(not exists (select 1 from public.chat_messages where wa_message_id in ('v0', 'v1', 'v2')), 'Bestätigungsnachrichten landen nicht im Chat');

-- Weiterleitung an Mitglieder: Gesamtchat ohne Zusatz, Gruppe mit Chat-Namen, Direktchat als „(privat)“
insert into public.chat_members (chat_id, user_id) values (current_setting('tests.wachat')::uuid, '00000000-0000-0000-0000-0000000000c1') on conflict do nothing;
insert into public.chat_messages (chat_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Gesamtchat-Nachricht');
insert into public.chat_messages (chat_id, sender_id, body) values (current_setting('tests.wachat')::uuid, '00000000-0000-0000-0000-0000000000a1', 'Gruppen-Nachricht');
set role service_role;
select set_config('tests.l1', (select string_agg(sender_label || '|' || in_window::text, ',') from public.whatsapp_outbound((select id from public.chat_messages where body = 'Gesamtchat-Nachricht'))), false);
select set_config('tests.l2', (select string_agg(phone || '=' || sender_label, ',' order by phone) from public.whatsapp_outbound((select id from public.chat_messages where body = 'Gruppen-Nachricht'))), false);
reset role;
select tests.ok(current_setting('tests.l1') = 'Ada Admin|true', 'Gesamtchat: Absendername, Mitglied hat kürzlich geschrieben (Fenster offen)');
select tests.ok(current_setting('tests.l2') = '4915111111111=Gemeinde-Helfer · Ada Admin,4915130000001=Gemeinde-Helfer · Ada Admin', 'Gruppe: Chat-Name vor dem Absender, Nummern und Mitglieder zusammen');

-- Antworten: in den Chat, aus dem zuletzt eine Nachricht kam
set role service_role;
select public.whatsapp_handle_inbound('4915130000001', 'Uta', 'Antwort an die Gruppe', 'r1');
reset role;
select tests.ok((select chat_id = current_setting('tests.wachat')::uuid and sender_id = '00000000-0000-0000-0000-0000000000c1' and source = 'whatsapp' from public.chat_messages where wa_message_id = 'r1'), 'Antwort landet im Chat der letzten Nachricht, mit Namen des Mitglieds');
update public.whatsapp_member_state set active_at = now() - interval '30 hours' where user_id = '00000000-0000-0000-0000-0000000000c1';
set role service_role;
select public.whatsapp_handle_inbound('4915130000001', 'Uta', 'Spätere Antwort', 'r2');
select public.whatsapp_handle_inbound('4915130000001', 'Uta', 'Spätere Antwort', 'r2');
reset role;
select tests.ok((select count(*) from public.chat_messages where wa_message_id = 'r2' and chat_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'Nach 24 h landet die Antwort im Gesamtchat (und wird nicht doppelt gespeichert)');

-- eigene Nachrichten des Mitglieds gehen nicht an es selbst zurück
set role service_role;
select set_config('tests.e1', (select string_agg(phone, ',') from public.whatsapp_outbound((select id from public.chat_messages where wa_message_id = 'r1'))), false);
reset role;
select tests.ok(current_setting('tests.e1') = '4915111111111', 'Antwort eines Mitglieds geht nur an die anderen, nicht zurück an das Mitglied');

-- verbundene Chats, Status „übersprungen“, Abwahl
set role authenticated;
select tests.as_user('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select n from public.whatsapp_bridged_chats() where chat_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'Gesamtchat zählt als verbunden, sobald ein Mitglied bestätigt ist');
select tests.as_user('00000000-0000-0000-0000-0000000000c1');
select tests.ok((select (public.set_my_whatsapp('+49 151 30000001', false)::jsonb ->> 'status') = 'off'), 'Abwahl der WhatsApp-Nachrichten');
reset role;
select tests.ok((select whatsapp_verified_at is not null and not whatsapp_optin from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'Nummer bleibt bestätigt, Zustimmung ist entzogen');
set role service_role;
select set_config('tests.o2', (select count(*)::text from public.whatsapp_outbound((select id from public.chat_messages where body = 'Hallo alle'))), false);
select public.whatsapp_set_delivery((select id from public.whatsapp_deliveries where status = 'pending' limit 1), 'skipped', '24h');
reset role;
select tests.ok((select count(*) from public.whatsapp_deliveries where status = 'skipped') = 1, 'Status „übersprungen“ wird gespeichert');

-- Registrierung mit Nummer und Zustimmung
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'neu1@test.local', '{"full_name":"Neu Eins","username":"neu1","phone":"+49 170 5550001","whatsapp_optin":"true"}', '{"admin_created":true}'),
  ('00000000-0000-0000-0000-0000000000d2', 'neu2@test.local', '{"full_name":"Neu Zwei","username":"neu2","phone":"+49 170 5550001","whatsapp_optin":"true"}', '{"admin_created":true}'),
  ('00000000-0000-0000-0000-0000000000d3', 'neu3@test.local', '{"full_name":"Neu Drei","username":"neu3","phone":"+49 170 5550003"}', '{"admin_created":true}');
select tests.ok((select phone = '491705550001' and whatsapp_optin and whatsapp_verified_at is null and length(wa_verify_code) = 6 from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'), 'Registrierung mit Nummer und Zustimmung: gespeichert, aber unbestätigt');
select tests.ok((select phone is null and not whatsapp_optin from public.profiles where id = '00000000-0000-0000-0000-0000000000d2'), 'Doppelte Nummer bei der Registrierung wird nicht übernommen');
select tests.ok((select phone = '491705550003' and not whatsapp_optin and wa_verify_code is null from public.profiles where id = '00000000-0000-0000-0000-0000000000d3'), 'Nummer ohne Zustimmung: gespeichert, aber WhatsApp aus');

\echo 'ALLE DATENBANK-TESTS BESTANDEN'
