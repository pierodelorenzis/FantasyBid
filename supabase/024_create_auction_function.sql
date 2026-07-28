-- Crea una nuova asta sia nello snapshot di compatibilità sia nelle tabelle
-- relazionali usate dalle operazioni atomiche (ingresso, offerte, assegnazioni).

create or replace function public.create_auction(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := p_state ->> 'code';
begin
  if v_code is null or char_length(v_code) <> 6 then
    raise exception 'Codice asta non valido';
  end if;

  insert into public.auctions (
    code,
    name,
    budget,
    status,
    total_slots,
    remaining_slots,
    current_index,
    rules,
    tier_settings,
    player_order,
    order_by_role,
    countdown_ends_at,
    start_countdown_ends_at,
    roster_warning,
    version
  ) values (
    v_code,
    p_state ->> 'name',
    (p_state ->> 'budget')::integer,
    p_state ->> 'status',
    (p_state ->> 'totalSlots')::integer,
    (p_state ->> 'remainingSlots')::integer,
    coalesce((p_state ->> 'currentIndex')::integer, 0),
    coalesce(p_state -> 'rules', '{}'::jsonb),
    coalesce(p_state -> 'tierSettings', '[]'::jsonb),
    p_state ->> 'playerOrder',
    coalesce((p_state ->> 'orderByRole')::boolean, false),
    nullif(p_state ->> 'countdownEndsAt', '')::bigint,
    nullif(p_state ->> 'startCountdownEndsAt', '')::bigint,
    p_state -> 'rosterWarning',
    1
  );

  insert into public.auction_participants (
    auction_code, token, name, role, budget, committed
  )
  select
    v_code,
    participant ->> 'token',
    participant ->> 'name',
    participant ->> 'role',
    (participant ->> 'budget')::integer,
    coalesce((participant ->> 'committed')::integer, 0)
  from jsonb_array_elements(coalesce(p_state -> 'participants', '[]'::jsonb))
    as participant;

  insert into public.auction_players (
    auction_code,
    id,
    sequence_index,
    name,
    role,
    team,
    nation,
    tier,
    number,
    quote,
    highest_bid_participant_token,
    highest_bid_participant_name,
    highest_bid_amount
  )
  select
    v_code,
    player ->> 'id',
    ordinal - 1,
    player ->> 'name',
    player ->> 'role',
    nullif(player ->> 'team', ''),
    nullif(player ->> 'nation', ''),
    player ->> 'tier',
    nullif(player ->> 'number', ''),
    coalesce((player ->> 'quote')::integer, 0),
    player -> 'highestBid' ->> 'participantToken',
    player -> 'highestBid' ->> 'participantName',
    (player -> 'highestBid' ->> 'amount')::integer
  from jsonb_array_elements(coalesce(p_state -> 'players', '[]'::jsonb))
    with ordinality as source(player, ordinal);

  insert into public.auction_snapshots (code, state, version, updated_at)
  values (v_code, p_state, 1, now());

  return jsonb_build_object('version', 1);
end;
$$;

revoke all on function public.create_auction(jsonb)
  from anon, authenticated;
