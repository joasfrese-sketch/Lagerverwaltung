-- =====================================================================
-- 006: Katalog-Sicht mit Verfügbarkeit (für Filter, Sortierung, Suche, Dashboard)
-- (wiederholbar, löscht keine Daten)
-- =====================================================================
create index if not exists rentals_item_status_idx on public.rentals(item_id, status, start_at);

drop view if exists public.catalog_items;
create view public.catalog_items as
select i.*,
  exists (select 1 from public.rentals r where r.item_id = i.id and r.status = 'active' and r.start_at <= now()) as rented_now,
  (select max(r.end_at) from public.rentals r where r.item_id = i.id and r.status = 'active' and r.start_at <= now()) as rented_until,
  (i.item_type = 'consumable' and i.stock_quantity <= i.min_stock) as low_stock
from public.items i;

revoke all on public.catalog_items from anon;
grant select on public.catalog_items to authenticated;
