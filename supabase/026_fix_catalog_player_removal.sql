-- La posizione nella sequenza non identifica un giocatore chiamato: dopo una
-- chiamata manuale o un riordino può appartenere a un giocatore ancora libero.
-- Il blocco si basa solo su chiamata registrata, offerta corrente o presenza in rosa.

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

  if v_player.highest_bid_participant_token is not null
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

revoke all on function public.remove_catalog_player(text, text, text)
  from anon, authenticated;
