-- Prima operazione live atomica. La funzione blocca l'asta, il partecipante e
-- il giocatore corrente prima di applicare un rilancio, evitando che due
-- offerte simultanee possano entrambe risultare valide.

create or replace function public.place_bid(
  p_auction_code text,
  p_participant_token text,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_participant public.auction_participants%rowtype;
  v_player public.auction_players%rowtype;
  v_minimum integer;
  v_increment integer;
  v_cap integer;
  v_spent_in_tier integer;
  v_remaining_credits integer;
  v_remaining_slots integer;
  v_available_players integer;
  v_minimum_required_credits integer;
  v_warning jsonb;
begin
  select * into v_auction
  from public.auctions
  where code = p_auction_code
  for update;
  if not found then
    raise exception 'Asta non trovata';
  end if;
  if v_auction.status <> 'live' then
    raise exception 'L’asta non è attiva';
  end if;

  select * into v_participant
  from public.auction_participants
  where auction_code = p_auction_code
    and token = p_participant_token
  for update;
  if not found then
    raise exception 'Sessione non valida';
  end if;

  select * into v_player
  from public.auction_players
  where auction_code = p_auction_code
    and sequence_index = v_auction.current_index
  for update;
  if not found then
    raise exception 'Nessun giocatore in vendita';
  end if;
  if v_player.highest_bid_participant_token = p_participant_token then
    raise exception 'Sei già in testa con l’ultima offerta';
  end if;

  v_increment := coalesce(
    (v_auction.rules -> v_player.tier ->> 'increment')::integer,
    0
  );
  v_cap := coalesce((v_auction.rules -> v_player.tier ->> 'cap')::integer, 0);
  v_minimum := case
    when v_player.highest_bid_amount is null
      then coalesce((v_auction.rules -> v_player.tier ->> 'minPrice')::integer, 0)
    else v_player.highest_bid_amount + v_increment
  end;
  if p_amount < v_minimum then
    raise exception 'Rilancio minimo: %', v_minimum;
  end if;
  if p_amount > v_participant.budget - v_participant.committed then
    raise exception 'Crediti non sufficienti';
  end if;

  select coalesce(sum(roster.price), 0) into v_spent_in_tier
  from public.roster_players roster
  join public.auction_players player
    on player.auction_code = roster.auction_code
    and player.id = roster.player_id
  where roster.auction_code = p_auction_code
    and roster.participant_token = p_participant_token
    and player.tier = v_player.tier;
  if v_spent_in_tier + p_amount > v_cap then
    raise exception 'Superato il tetto Fascia %', v_player.tier;
  end if;

  select count(*) into v_remaining_slots
  from public.roster_players
  where auction_code = p_auction_code
    and participant_token = p_participant_token;
  v_remaining_slots := greatest(0, v_auction.total_slots - (v_remaining_slots + 1));
  v_remaining_credits := v_participant.budget - v_participant.committed - p_amount;

  select count(*) into v_available_players
  from public.auction_players
  where auction_code = p_auction_code
    and sequence_index > v_auction.current_index;
  if v_available_players >= v_remaining_slots then
    select coalesce(sum(min_price), 0) into v_minimum_required_credits
    from (
      select coalesce((v_auction.rules -> player.tier ->> 'minPrice')::integer, 0)
        as min_price
      from public.auction_players player
      where player.auction_code = p_auction_code
        and player.sequence_index > v_auction.current_index
      order by min_price
      limit v_remaining_slots
    ) cheapest_players;
  else
    v_minimum_required_credits := null;
  end if;

  if v_available_players < v_remaining_slots
    or v_remaining_credits < v_minimum_required_credits then
    v_warning := jsonb_build_object(
      'participantName', v_participant.name,
      'remainingCredits', v_remaining_credits,
      'remainingSlots', v_remaining_slots,
      'availablePlayers', v_available_players,
      'minimumRequiredCredits', v_minimum_required_credits,
      'notEnoughAvailablePlayers', v_available_players < v_remaining_slots
    );
  else
    v_warning := null;
  end if;

  update public.auction_players
  set
    highest_bid_participant_token = v_participant.token,
    highest_bid_participant_name = v_participant.name,
    highest_bid_amount = p_amount
  where auction_code = p_auction_code
    and id = v_player.id;

  insert into public.auction_activity (auction_code, position, name, action, amount)
  values (
    p_auction_code,
    coalesce(
      (select max(position) + 1 from public.auction_activity where auction_code = p_auction_code),
      0
    ),
    v_participant.name,
    'rilancia su ' || v_player.name,
    p_amount
  );

  update public.auctions
  set
    roster_warning = v_warning,
    version = auctions.version + 1,
    updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object(
    'auctionCode', p_auction_code,
    'playerId', v_player.id,
    'participantName', v_participant.name,
    'amount', p_amount,
    'version', v_auction.version + 1,
    'rosterWarning', v_warning
  );
end;
$$;

revoke all on function public.place_bid(text, text, integer)
  from anon, authenticated;
