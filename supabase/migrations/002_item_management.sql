-- =====================================================================
-- 002: Artikel löschen & Sammel-Statuswechsel (nach 001 einmal ausführen, wiederholbar)
-- =====================================================================

-- Schutz: Ausgeliehene Artikel können nicht gelöscht werden; jede Löschung wird protokolliert.
create or replace function public.guard_item_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from rentals where item_id = old.id and status = 'active') then
    raise exception 'Artikel „%" ist noch ausgeliehen und kann nicht gelöscht werden', old.name;
  end if;
  insert into activity_log (actor_id, action, item_id, item_name, details)
    values (auth.uid(), 'GELÖSCHT', old.id, old.name, jsonb_build_object('room', old.room_id));
  return old;
end $$;

drop trigger if exists items_delete_guard on public.items;
create trigger items_delete_guard before delete on public.items
  for each row execute function public.guard_item_delete();

-- Sammel-Statuswechsel mit Protokoll (nur Verantwortliche des jeweiligen Raums)
create or replace function public.bulk_set_item_status(p_ids text[], p_status text) returns int
language plpgsql security definer set search_path = public as $$
declare v_item items; v_n int := 0;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_status not in ('active','maintenance','inventory') then raise exception 'Ungültiger Status'; end if;
  for v_item in select * from items where id = any(p_ids) loop
    if not is_manager_for(v_item.room_id) then raise exception 'Keine Berechtigung für „%"', v_item.name; end if;
    update items set status = p_status where id = v_item.id;
    insert into activity_log (actor_id, action, item_id, item_name, details)
      values (auth.uid(), 'STATUS', v_item.id, v_item.name, jsonb_build_object('status', p_status));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke execute on function public.guard_item_delete() from public, anon, authenticated;
revoke execute on function public.bulk_set_item_status(text[], text) from public, anon;
grant execute on function public.bulk_set_item_status(text[], text) to authenticated;
