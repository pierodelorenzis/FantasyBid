-- Import atomico del catalogo. Per evitare rose o offerte riferite a giocatori
-- sostituiti, l'import è consentito solo prima dell'avanzamento dell'asta.

create or replace function public.import_auction_catalog(
  p_auction_code text,
  p_admin_token text,
  p_players jsonb,
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
  v_player_count integer;
begin
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 then
    raise exception 'Nessun giocatore riconosciuto';
  end if;
  if jsonb_typeof(p_history) <> 'array' then
    raise exception 'Cronologia import non valida';
  end if;

  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;
  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  for update;
  if not found then raise exception 'Operazione riservata all’admin'; end if;

  if v_auction.current_index <> 0
    or exists (select 1 from public.roster_players where auction_code = p_auction_code)
    or exists (
      select 1 from public.auction_players
      where auction_code = p_auction_code
        and highest_bid_participant_token is not null
    ) then
    raise exception 'Azzera prima l’avanzamento dell’asta prima di importare un nuovo catalogo';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_players) as player(value)
    where coalesce(trim(player.value ->> 'id'), '') = ''
      or coalesce(trim(player.value ->> 'name'), '') = ''
      or player.value ->> 'role' not in ('POR', 'DIF', 'CEN', 'ATT')
      or coalesce((player.value ->> 'quote')::integer, 0) < 0
  ) then
    raise exception 'Catalogo giocatori non valido';
  end if;
  select count(*) into v_player_count from jsonb_array_elements(p_players);
  if v_player_count <> (
    select count(distinct value ->> 'id') from jsonb_array_elements(p_players) as player(value)
  ) then
    raise exception 'Identificativi giocatore duplicati';
  end if;

  delete from public.auction_history where auction_code = p_auction_code;
  delete from public.auction_players where auction_code = p_auction_code;

  insert into public.auction_players (
    auction_code, id, sequence_index, name, role, team, nation, tier, number,
    quote
  )
  select
    p_auction_code,
    player.value ->> 'id',
    player.ordinality::integer - 1,
    player.value ->> 'name',
    player.value ->> 'role',
    player.value ->> 'team',
    player.value ->> 'nation',
    coalesce(
      (
        select tier.value ->> 'name'
        from jsonb_array_elements(v_auction.tier_settings) as tier(value)
        where coalesce((player.value ->> 'quote')::integer, 0) >= (tier.value ->> 'minQuote')::integer
        order by (tier.value ->> 'minQuote')::integer desc
        limit 1
      ),
      v_auction.tier_settings -> -1 ->> 'name'
    ),
    player.value ->> 'number',
    coalesce((player.value ->> 'quote')::integer, 0)
  from jsonb_array_elements(p_players) with ordinality as player(value, ordinality);

  insert into public.auction_history (auction_code, position, snapshot)
  select p_auction_code, history.ordinality::integer - 1, history.value
  from jsonb_array_elements(p_history) with ordinality as history(value, ordinality);

  update public.auctions
  set
    current_index = 0,
    remaining_slots = total_slots,
    player_order = null,
    order_by_role = false,
    roster_warning = null,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object(
    'playerCount', v_player_count,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.import_auction_catalog(text, text, jsonb, jsonb)
  from anon, authenticated;
