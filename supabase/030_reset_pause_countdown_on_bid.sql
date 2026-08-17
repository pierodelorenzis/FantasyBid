-- Keep "Ultima chiamata" active after a valid bid. Every bid moves its shared
-- deadline forward by five visible seconds plus the two-second delivery grace.

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
    set countdown_ends_at = floor(extract(epoch from clock_timestamp()) * 1000)::bigint + 7000
    where code = new.auction_code
      and countdown_ends_at is not null;
  end if;
  return new;
end;
$$;
