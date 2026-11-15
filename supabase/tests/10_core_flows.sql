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

\echo 'ALLE DATENBANK-TESTS BESTANDEN'
