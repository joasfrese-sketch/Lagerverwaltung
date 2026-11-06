-- =====================================================================
-- 003: Artikelfotos (bis zu 5 pro Artikel) – Supabase Storage (wiederholbar, löscht keine Daten)
-- =====================================================================

-- Stabiler Ordnername pro Artikel (unabhängig von Sonderzeichen in der Artikel-ID)
alter table public.items add column if not exists photo_key uuid not null default gen_random_uuid();
create unique index if not exists items_photo_key_idx on public.items(photo_key);

-- Höchstens 5 Fotos, nur als Liste
alter table public.items drop constraint if exists items_photos_max5;
alter table public.items add constraint items_photos_max5
  check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 5);

-- Öffentlicher Bucket (Bilder sind per unratbarem Link abrufbar), max. 2 MB, nur Bildformate
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Hochladen / Ändern / Löschen nur durch Verantwortliche des jeweiligen Raums
drop policy if exists item_photos_select on storage.objects;
drop policy if exists item_photos_insert on storage.objects;
drop policy if exists item_photos_update on storage.objects;
drop policy if exists item_photos_delete on storage.objects;

create policy item_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'item-photos');

create policy item_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'item-photos' and exists (
    select 1 from public.items i
    where i.photo_key::text = (storage.foldername(name))[1] and public.is_manager_for(i.room_id)));

create policy item_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'item-photos' and exists (
    select 1 from public.items i
    where i.photo_key::text = (storage.foldername(name))[1] and public.is_manager_for(i.room_id)));

create policy item_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'item-photos' and exists (
    select 1 from public.items i
    where i.photo_key::text = (storage.foldername(name))[1] and public.is_manager_for(i.room_id)));
