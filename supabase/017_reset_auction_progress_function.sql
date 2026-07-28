-- Il pulsante "Cancella movimenti" azzera l'avanzamento dell'asta, non solo
-- l'elenco visivo: offerte, assegnazioni, rose e cronologia tornano allo stato
-- iniziale mantenendo catalogo, regole e partecipanti.

create or replace function public.clear_auction_activity(
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
  v_deleted_count integer;
begin
  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;

  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  for update;
  if not found then raise exception 'Operazione riservata all’admin'; end if;

  delete from public.auction_activity where auction_code = p_auction_code;
  get diagnostics v_deleted_count = row_count;
  delete from public.auction_history where auction_code = p_auction_code;
  delete from public.roster_players where auction_code = p_auction_code;
  update public.auction_participants
  set committed = 0
  where auction_code = p_auction_code;
  update public.auction_players
  set
    highest_bid_participant_token = null,
    highest_bid_participant_name = null,
    highest_bid_amount = null
  where auction_code = p_auction_code;
  update public.auctions
  set
    status = 'paused',
    current_index = 0,
    remaining_slots = total_slots,
    countdown_ends_at = null,
    start_countdown_ends_at = null,
    roster_warning = null,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object(
    'deletedCount', v_deleted_count,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.clear_auction_activity(text, text)
  from anon, authenticated;
