-- Applicazione atomica di un nuovo ordine dei giocatori non ancora chiamati.
-- L'ordine viene calcolato dal server applicativo e questa funzione lo valida
-- integralmente prima di aggiornare la sequenza relazionale.

create or replace function public.set_player_order(
  p_auction_code text,
  p_admin_token text,
  p_player_ids jsonb,
  p_player_order text,
  p_order_by_role boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_administrator public.auction_participants%rowtype;
  v_remaining_count integer;
  v_requested_count integer;
  v_action text;
begin
  if jsonb_typeof(p_player_ids) <> 'array' then
    raise exception 'Ordine giocatori non valido';
  end if;
  if p_player_order is not null and p_player_order not in ('alphabetical', 'random') then
    raise exception 'Tipo di ordinamento non valido';
  end if;

  select * into v_auction
  from public.auctions
  where code = p_auction_code
  for update;
  if not found then
    raise exception 'Asta non trovata';
  end if;
  if v_auction.status <> 'paused' then
    raise exception 'Metti in pausa l’asta prima di riordinare i giocatori';
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

  select count(*) into v_remaining_count
  from public.auction_players
  where auction_code = p_auction_code
    and sequence_index >= v_auction.current_index;
  select count(*) into v_requested_count
  from jsonb_array_elements_text(p_player_ids);
  if v_requested_count <> v_remaining_count
    or v_requested_count <> (
      select count(distinct player_id)
      from jsonb_array_elements_text(p_player_ids) as requested(player_id)
    )
    or exists (
      select 1
      from jsonb_array_elements_text(p_player_ids) as requested(player_id)
      left join public.auction_players player
        on player.auction_code = p_auction_code
        and player.id = requested.player_id
        and player.sequence_index >= v_auction.current_index
      where player.id is null
    ) then
    raise exception 'L’ordine deve includere una sola volta ogni giocatore non chiamato';
  end if;

  update public.auction_players
  set sequence_index = sequence_index + 1000000
  where auction_code = p_auction_code
    and sequence_index >= v_auction.current_index;

  with requested as (
    select player_id, ordinality::integer as position
    from jsonb_array_elements_text(p_player_ids) with ordinality
      as requested(player_id, ordinality)
  )
  update public.auction_players player
  set sequence_index = v_auction.current_index + requested.position - 1
  from requested
  where player.auction_code = p_auction_code
    and player.id = requested.player_id;

  v_action := 'ordina i giocatori'
    || case when p_order_by_role then ' per ruolo' else '' end
    || case
      when p_player_order = 'alphabetical' then ' alfabeticamente'
      when p_player_order = 'random' then ' in modo casuale'
      else ''
    end;

  update public.auctions
  set
    player_order = p_player_order,
    order_by_role = p_order_by_role,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;

  insert into public.auction_activity (auction_code, position, name, action)
  values (
    p_auction_code,
    coalesce(
      (
        select max(position) + 1
        from public.auction_activity
        where auction_code = p_auction_code
      ),
      0
    ),
    v_administrator.name,
    v_action
  );

  return jsonb_build_object(
    'playerOrder', p_player_order,
    'orderByRole', p_order_by_role,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.set_player_order(text, text, jsonb, text, boolean)
  from anon, authenticated;
