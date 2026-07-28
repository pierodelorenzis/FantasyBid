-- Aggiornamento atomico di quotazione e fascia di un singolo giocatore.

create or replace function public.update_catalog_player(
  p_auction_code text,
  p_admin_token text,
  p_player_id text,
  p_quote integer,
  p_tier text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_administrator public.auction_participants%rowtype;
  v_player public.auction_players%rowtype;
begin
  if p_quote is null or p_quote < 0 then
    raise exception 'Quotazione non valida';
  end if;

  select * into v_auction
  from public.auctions
  where code = p_auction_code
  for update;
  if not found then
    raise exception 'Asta non trovata';
  end if;

  select * into v_administrator
  from public.auction_participants
  where auction_code = p_auction_code
    and token = p_admin_token
    and role = 'admin'
  for update;
  if not found then
    raise exception 'Operazione riservata all’admin';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_auction.tier_settings) as tier(value)
    where tier.value ->> 'name' = p_tier
  ) then
    raise exception 'Fascia non valida';
  end if;

  select * into v_player
  from public.auction_players
  where auction_code = p_auction_code
    and id = p_player_id
  for update;
  if not found then
    raise exception 'Giocatore non trovato';
  end if;

  update public.auction_players
  set quote = p_quote, tier = p_tier
  where auction_code = p_auction_code
    and id = p_player_id;

  update public.auctions
  set version = version + 1, updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object(
    'playerId', v_player.id,
    'quote', p_quote,
    'tier', p_tier,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.update_catalog_player(text, text, text, integer, text)
  from anon, authenticated;
