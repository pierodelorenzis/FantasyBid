-- Completa l'assegnazione atomica registrando anche la chiamata automatica
-- del giocatore successivo, se il catalogo non è terminato.

create or replace function public.close_current_player(
  p_auction_code text,
  p_admin_token text
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
  v_next_player public.auction_players%rowtype;
  v_winner public.auction_participants%rowtype;
  v_assigned boolean := false;
begin
  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;
  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  for update;
  if not found then raise exception 'Operazione riservata all’admin'; end if;
  select * into v_player from public.auction_players
  where auction_code = p_auction_code and sequence_index = v_auction.current_index
  for update;
  if not found then raise exception 'Nessun giocatore da assegnare'; end if;

  if v_player.highest_bid_participant_token is not null then
    select * into v_winner from public.auction_participants
    where auction_code = p_auction_code and token = v_player.highest_bid_participant_token
    for update;
    if not found then raise exception 'Offerente non trovato'; end if;
    insert into public.roster_players (auction_code, participant_token, player_id, price)
    values (p_auction_code, v_winner.token, v_player.id, v_player.highest_bid_amount);
    update public.auction_participants
    set committed = committed + v_player.highest_bid_amount
    where auction_code = p_auction_code and token = v_winner.token;
    insert into public.auction_activity (auction_code, position, name, action, amount)
    values (
      p_auction_code,
      coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
      v_winner.name,
      'acquista ' || v_player.name,
      v_player.highest_bid_amount
    );
    v_assigned := true;
  end if;

  update public.auctions
  set
    current_index = current_index + 1,
    remaining_slots = greatest(0, remaining_slots - 1),
    status = 'paused',
    roster_warning = null,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;
  insert into public.auction_activity (auction_code, position, name, action)
  values (
    p_auction_code,
    coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
    v_administrator.name,
    'mette in pausa l’asta'
  );

  select * into v_next_player from public.auction_players
  where auction_code = p_auction_code and sequence_index = v_auction.current_index + 1;
  if found then
    insert into public.auction_activity (auction_code, position, name, action)
    values (
      p_auction_code,
      coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
      v_administrator.name,
      'chiama ' || v_next_player.name
    );
  end if;

  return jsonb_build_object(
    'auctionCode', p_auction_code,
    'playerId', v_player.id,
    'assigned', v_assigned,
    'winnerToken', case when v_assigned then v_winner.token else null end,
    'winnerName', case when v_assigned then v_winner.name else null end,
    'amount', case when v_assigned then v_player.highest_bid_amount else null end,
    'nextPlayerId', case when found then v_next_player.id else null end,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.close_current_player(text, text)
  from anon, authenticated;
