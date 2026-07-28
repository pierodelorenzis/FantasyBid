-- Una puntata valida durante "Ultima chiamata" annulla il countdown di pausa.
-- Il trigger agisce sulla stessa transazione della puntata atomica.

create or replace function public.cancel_pause_countdown_after_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.highest_bid_amount is distinct from old.highest_bid_amount
    and new.highest_bid_amount is not null then
    update public.auctions
    set countdown_ends_at = null
    where code = new.auction_code
      and countdown_ends_at is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists cancel_pause_countdown_after_bid
  on public.auction_players;
create trigger cancel_pause_countdown_after_bid
after update of highest_bid_amount on public.auction_players
for each row
execute function public.cancel_pause_countdown_after_bid();
