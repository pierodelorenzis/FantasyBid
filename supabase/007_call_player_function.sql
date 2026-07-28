-- Chiamata atomica di un giocatore. Lo scambio dell'ordine usa un indice
-- temporaneo valido per rispettare il vincolo univoco sulla sequenza.

create or replace function public.call_player(
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
  v_administrator public.auction_participants%rowtype;
  v_current_player public.auction_players%rowtype;
  v_selected_player public.auction_players%rowtype;
  v_temporary_index integer;
begin
  select * into v_auction
  from public.auctions
  where code = p_auction_code
  for update;
  if not found then
    raise exception 'Asta non trovata';
  end if;

  select * into v_administrator
  from public.auction_participants
  where auction_code = p_auction_code
    and token = p_admin_token
    and role = 'admin'
  for update;
  if not found then
    raise exception 'Operazione riservata all’admin';
  end if;

  select * into v_current_player
  from public.auction_players
  where auction_code = p_auction_code
    and sequence_index = v_auction.current_index
  for update;
  if not found then
    raise exception 'Nessun giocatore da chiamare';
  end if;

  select * into v_selected_player
  from public.auction_players
  where auction_code = p_auction_code
    and id = p_player_id
  for update;
  if not found then
    raise exception 'Giocatore non trovato';
  end if;
  if v_selected_player.sequence_index < v_auction.current_index then
    raise exception 'Questo giocatore è già stato chiamato';
  end if;
  if v_selected_player.id <> v_current_player.id
    and v_current_player.highest_bid_amount is not null then
    raise exception 'Assegna prima il giocatore attualmente in vendita';
  end if;

  if v_selected_player.id <> v_current_player.id then
    select coalesce(max(sequence_index), 0) + 1 into v_temporary_index
    from public.auction_players
    where auction_code = p_auction_code;

    update public.auction_players
    set sequence_index = v_temporary_index
    where auction_code = p_auction_code
      and id = v_current_player.id;

    update public.auction_players
    set sequence_index = v_auction.current_index
    where auction_code = p_auction_code
      and id = v_selected_player.id;

    update public.auction_players
    set sequence_index = v_selected_player.sequence_index
    where auction_code = p_auction_code
      and id = v_current_player.id;
  end if;

  update public.auctions
  set
    status = 'paused',
    roster_warning = null,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object(
    'playerId', v_selected_player.id,
    'status', 'paused',
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.call_player(text, text, text)
  from anon, authenticated;
