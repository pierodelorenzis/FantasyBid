-- Quando una squadra viene rimossa, le offerte ancora riferite a quel token
-- non sono più valide e devono essere eliminate dal catalogo relazionale.

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

  update public.auction_players
  set
    highest_bid_participant_token = null,
    highest_bid_participant_name = null,
    highest_bid_amount = null
  where auction_code = p_auction_code
    and highest_bid_participant_token = p_participant_token;

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

create or replace function public.clear_orphaned_bids(
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
      and player.highest_bid_participant_token is not null
      and not exists (
        select 1
        from public.auction_participants participant
        where participant.auction_code = player.auction_code
          and participant.token = player.highest_bid_participant_token
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

revoke all on function public.remove_auction_participant(text, text, text)
  from anon, authenticated;
revoke all on function public.clear_orphaned_bids(text, text)
  from anon, authenticated;
