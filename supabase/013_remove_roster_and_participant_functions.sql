-- Rimozione atomica di un giocatore dalla rosa e di una squadra partecipante.

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

create or replace function public.remove_auction_participant(
  p_auction_code text,
  p_admin_token text,
  p_participant_token text
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

  delete from public.auction_participants
  where auction_code = p_auction_code and token = p_participant_token;
  update public.auctions
  set version = version + 1, updated_at = now()
  where code = p_auction_code;
  insert into public.auction_activity (auction_code, position, name, action)
  values (
    p_auction_code,
    coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
    v_administrator.name,
    'rimuove il partecipante ' || v_participant.name
  );
  return jsonb_build_object(
    'participantToken', v_participant.token,
    'participantName', v_participant.name,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.remove_roster_player(text, text, text, text)
  from anon, authenticated;
revoke all on function public.remove_auction_participant(text, text, text)
  from anon, authenticated;
