-- La rimozione di un giocatore dalla rosa annulla anche la sua assegnazione.

create or replace function public.remove_roster_player(
  p_auction_code text,
  p_admin_token text,
  p_participant_token text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_administrator public.auction_participants%rowtype;
  v_participant public.auction_participants%rowtype;
  v_player_name text;
  v_price integer;
begin
  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;

  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  for update;
  if not found then raise exception 'Operazione riservata all’admin'; end if;

  select * into v_participant from public.auction_participants
  where auction_code = p_auction_code and token = p_participant_token and role = 'participant'
  for update;
  if not found then raise exception 'Partecipante non trovato'; end if;

  select roster.price, player.name into v_price, v_player_name
  from public.roster_players roster
  join public.auction_players player
    on player.auction_code = roster.auction_code and player.id = roster.player_id
  where roster.auction_code = p_auction_code
    and roster.participant_token = p_participant_token
    and roster.player_id = p_player_id
  for update of roster;
  if not found then raise exception 'Giocatore non trovato nella squadra'; end if;

  delete from public.roster_players
  where auction_code = p_auction_code
    and participant_token = p_participant_token
    and player_id = p_player_id;
  update public.auction_players
  set
    highest_bid_participant_token = null,
    highest_bid_participant_name = null,
    highest_bid_amount = null
  where auction_code = p_auction_code
    and id = p_player_id;
  update public.auction_participants
  set committed = greatest(0, committed - v_price)
  where auction_code = p_auction_code and token = p_participant_token;
  update public.auctions
  set version = version + 1, updated_at = now()
  where code = p_auction_code;
  insert into public.auction_activity (auction_code, position, name, action)
  values (
    p_auction_code,
    coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
    v_administrator.name,
    'rimuove ' || v_player_name || ' dalla squadra di ' || v_participant.name
  );
  return jsonb_build_object(
    'participantToken', v_participant.token,
    'playerId', p_player_id,
    'price', v_price,
    'version', v_auction.version + 1
  );
end;
$$;

create or replace function public.clear_completed_unassigned_bids(
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
  v_player_ids jsonb;
begin
  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;

  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  for update;
  if not found then raise exception 'Operazione riservata all’admin'; end if;

  with cleared as (
    update public.auction_players player
    set
      highest_bid_participant_token = null,
      highest_bid_participant_name = null,
      highest_bid_amount = null
    where player.auction_code = p_auction_code
      and player.sequence_index < v_auction.current_index
      and player.highest_bid_participant_token is not null
      and not exists (
        select 1
        from public.roster_players roster
        where roster.auction_code = player.auction_code
          and roster.player_id = player.id
          and roster.participant_token = player.highest_bid_participant_token
      )
    returning player.id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) into v_player_ids
  from cleared;

  if jsonb_array_length(v_player_ids) > 0 then
    update public.auctions
    set version = version + 1, updated_at = now()
    where code = p_auction_code;
  end if;

  return jsonb_build_object(
    'playerIds', v_player_ids,
    'version', v_auction.version + case when jsonb_array_length(v_player_ids) > 0 then 1 else 0 end
  );
end;
$$;

revoke all on function public.remove_roster_player(text, text, text, text)
  from anon, authenticated;
revoke all on function public.clear_completed_unassigned_bids(text, text)
  from anon, authenticated;
