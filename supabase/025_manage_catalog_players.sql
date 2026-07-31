-- Inserimento e rimozione atomici dei giocatori del catalogo.

create or replace function public.add_catalog_player(
  p_auction_code text,
  p_admin_token text,
  p_name text,
  p_role text,
  p_team text,
  p_nation text,
  p_quote integer,
  p_tier text,
  p_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_player_id text := replace(gen_random_uuid()::text, '-', '');
  v_sequence integer;
  v_name text := trim(p_name);
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Nome giocatore non valido';
  end if;
  if p_role not in ('POR', 'DIF', 'CEN', 'ATT') then
    raise exception 'Ruolo giocatore non valido';
  end if;
  if p_quote is null or p_quote < 0 then
    raise exception 'Quotazione non valida';
  end if;

  select * into v_auction
  from public.auctions
  where code = p_auction_code
  for update;
  if not found then raise exception 'Asta non trovata'; end if;

  if not exists (
    select 1 from public.auction_participants
    where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  ) then raise exception 'Operazione riservata all’admin'; end if;

  if not exists (
    select 1 from jsonb_array_elements(v_auction.tier_settings) as tier(value)
    where tier.value ->> 'name' = p_tier
  ) then raise exception 'Fascia non valida'; end if;

  if exists (
    select 1 from public.auction_players
    where auction_code = p_auction_code and lower(name) = lower(v_name)
  ) then raise exception 'Esiste già un giocatore con questo nome'; end if;

  select coalesce(max(sequence_index) + 1, 0) into v_sequence
  from public.auction_players where auction_code = p_auction_code;

  insert into public.auction_players (
    auction_code, id, sequence_index, name, role, team, nation, tier, number, quote
  ) values (
    p_auction_code, v_player_id, v_sequence, v_name, p_role,
    nullif(trim(p_team), ''), nullif(trim(p_nation), ''), p_tier,
    nullif(trim(p_number), ''), p_quote
  );

  update public.auctions set version = version + 1, updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object(
    'id', v_player_id, 'name', v_name, 'role', p_role,
    'team', nullif(trim(p_team), ''), 'nation', nullif(trim(p_nation), ''),
    'tier', p_tier, 'number', nullif(trim(p_number), ''), 'quote', p_quote,
    'version', v_auction.version + 1
  );
end;
$$;

create or replace function public.remove_catalog_player(
  p_auction_code text,
  p_admin_token text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_player public.auction_players%rowtype;
begin
  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;

  if not exists (
    select 1 from public.auction_participants
    where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  ) then raise exception 'Operazione riservata all’admin'; end if;

  select * into v_player from public.auction_players
  where auction_code = p_auction_code and id = p_player_id for update;
  if not found then raise exception 'Giocatore non trovato'; end if;

  if v_player.sequence_index < v_auction.current_index
    or v_player.highest_bid_participant_token is not null
    or exists (
      select 1 from public.roster_players
      where auction_code = p_auction_code and player_id = p_player_id
    )
    or exists (
      select 1 from public.auction_activity
      where auction_code = p_auction_code and action = 'chiama ' || v_player.name
    ) then
    raise exception 'Non puoi rimuovere un giocatore già chiamato o assegnato';
  end if;

  delete from public.auction_players
  where auction_code = p_auction_code and id = p_player_id;

  update public.auction_players
  set sequence_index = sequence_index + 1000000
  where auction_code = p_auction_code and sequence_index > v_player.sequence_index;
  update public.auction_players
  set sequence_index = sequence_index - 1000001
  where auction_code = p_auction_code and sequence_index >= 1000000;

  update public.auctions set version = version + 1, updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object('playerId', p_player_id, 'version', v_auction.version + 1);
end;
$$;

revoke all on function public.add_catalog_player(text, text, text, text, text, text, integer, text, text)
  from anon, authenticated;
revoke all on function public.remove_catalog_player(text, text, text)
  from anon, authenticated;
