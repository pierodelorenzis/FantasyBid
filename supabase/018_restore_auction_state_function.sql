-- Ripristino atomico dello stato precedente dell'asta. La funzione riceve uno
-- snapshot interno prodotto dall'app e ricostruisce tutte le tabelle
-- relazionali nella medesima transazione.

create or replace function public.restore_auction_state(
  p_auction_code text,
  p_admin_token text,
  p_state jsonb,
  p_history jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_administrator public.auction_participants%rowtype;
begin
  if jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_history) <> 'array' then
    raise exception 'Snapshot di ripristino non valido';
  end if;

  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;
  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  for update;
  if not found then raise exception 'Operazione riservata all’admin'; end if;

  delete from public.auction_history where auction_code = p_auction_code;
  delete from public.auction_activity where auction_code = p_auction_code;
  delete from public.roster_players where auction_code = p_auction_code;
  delete from public.auction_players where auction_code = p_auction_code;
  delete from public.auction_participants where auction_code = p_auction_code;

  update public.auctions
  set
    name = p_state ->> 'name',
    budget = (p_state ->> 'budget')::integer,
    status = p_state ->> 'status',
    total_slots = (p_state ->> 'totalSlots')::integer,
    remaining_slots = (p_state ->> 'remainingSlots')::integer,
    current_index = (p_state ->> 'currentIndex')::integer,
    rules = coalesce(p_state -> 'rules', '{}'::jsonb),
    tier_settings = coalesce(p_state -> 'tierSettings', '[]'::jsonb),
    player_order = p_state ->> 'playerOrder',
    order_by_role = coalesce((p_state ->> 'orderByRole')::boolean, false),
    countdown_ends_at = nullif(p_state ->> 'countdownEndsAt', '')::bigint,
    start_countdown_ends_at = nullif(p_state ->> 'startCountdownEndsAt', '')::bigint,
    roster_warning = p_state -> 'rosterWarning',
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;

  insert into public.auction_participants (
    auction_code, token, name, role, budget, committed
  )
  select
    p_auction_code,
    participant.value ->> 'token',
    participant.value ->> 'name',
    participant.value ->> 'role',
    (participant.value ->> 'budget')::integer,
    coalesce((participant.value ->> 'committed')::integer, 0)
  from jsonb_array_elements(coalesce(p_state -> 'participants', '[]'::jsonb))
    as participant(value);

  insert into public.auction_players (
    auction_code, id, sequence_index, name, role, team, nation, tier, number,
    quote, highest_bid_participant_token, highest_bid_participant_name,
    highest_bid_amount
  )
  select
    p_auction_code,
    player.value ->> 'id',
    player.ordinality::integer - 1,
    player.value ->> 'name',
    player.value ->> 'role',
    player.value ->> 'team',
    player.value ->> 'nation',
    player.value ->> 'tier',
    player.value ->> 'number',
    coalesce((player.value ->> 'quote')::integer, 0),
    player.value #>> '{highestBid,participantToken}',
    player.value #>> '{highestBid,participantName}',
    nullif(player.value #>> '{highestBid,amount}', '')::integer
  from jsonb_array_elements(coalesce(p_state -> 'players', '[]'::jsonb))
    with ordinality as player(value, ordinality);

  insert into public.roster_players (
    auction_code, participant_token, player_id, price
  )
  select
    p_auction_code,
    participant.value ->> 'token',
    player.value ->> 'id',
    (player.value ->> 'price')::integer
  from jsonb_array_elements(coalesce(p_state -> 'participants', '[]'::jsonb))
    as participant(value)
  cross join lateral jsonb_array_elements(
    coalesce(participant.value -> 'players', '[]'::jsonb)
  ) as player(value);

  insert into public.auction_activity (
    auction_code, position, name, action, amount
  )
  select
    p_auction_code,
    activity.ordinality::integer - 1,
    activity.value ->> 'name',
    activity.value ->> 'action',
    nullif(activity.value ->> 'amount', '')::integer
  from jsonb_array_elements(coalesce(p_state -> 'activity', '[]'::jsonb))
    with ordinality as activity(value, ordinality);

  insert into public.auction_history (auction_code, position, snapshot)
  select
    p_auction_code,
    history.ordinality::integer - 1,
    history.value
  from jsonb_array_elements(p_history)
    with ordinality as history(value, ordinality);

  return jsonb_build_object(
    'version', v_auction.version + 1,
    'historyLength', jsonb_array_length(p_history)
  );
end;
$$;

revoke all on function public.restore_auction_state(text, text, jsonb, jsonb)
  from anon, authenticated;
