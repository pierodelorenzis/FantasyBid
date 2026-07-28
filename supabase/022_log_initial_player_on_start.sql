-- Registra la chiamata del primo giocatore quando l'asta viene avviata senza
-- una precedente selezione manuale del giocatore.

create or replace function public.log_initial_player_on_auction_start()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_name text;
  v_administrator_name text;
  v_action text;
begin
  if old.status = 'paused'
    and new.status = 'live'
    and new.current_index = 0 then
    select name into v_player_name
    from public.auction_players
    where auction_code = new.code and sequence_index = new.current_index;
    if v_player_name is null then return new; end if;
    v_action := 'chiama ' || v_player_name;
    if not exists (
      select 1 from public.auction_activity
      where auction_code = new.code and action = v_action
    ) then
      select name into v_administrator_name
      from public.auction_participants
      where auction_code = new.code and role = 'admin'
      limit 1;
      insert into public.auction_activity (auction_code, position, name, action)
      values (
        new.code,
        coalesce((select max(position) + 1 from public.auction_activity where auction_code = new.code), 0),
        v_administrator_name,
        v_action
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists log_initial_player_on_auction_start
  on public.auctions;
create trigger log_initial_player_on_auction_start
after update of status on public.auctions
for each row
execute function public.log_initial_player_on_auction_start();
