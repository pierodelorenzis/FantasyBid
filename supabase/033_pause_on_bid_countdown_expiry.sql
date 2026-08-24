-- Completa in modo atomico il timer ordinario delle puntate. Il confronto con
-- la scadenza attesa impedisce a un timer precedente di mettere in pausa
-- l'asta dopo che una nuova offerta ha già riavviato il countdown.

create or replace function public.complete_bid_countdown(
  p_auction_code text,
  p_admin_token text,
  p_expected_ends_at bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_administrator public.auction_participants%rowtype;
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;

  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code
    and token = p_admin_token
    and role = 'admin';
  if not found then raise exception 'Operazione riservata all’admin'; end if;

  if v_auction.status <> 'live'
    or v_auction.countdown_ends_at is not null
    or v_auction.bid_countdown_ends_at is distinct from p_expected_ends_at
    or v_auction.bid_countdown_ends_at > v_now then
    return jsonb_build_object('completed', false);
  end if;

  update public.auctions set
    status = 'paused',
    bid_countdown_ends_at = null,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;

  insert into public.auction_activity (auction_code, position, name, action)
  values (
    p_auction_code,
    coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
    v_administrator.name,
    'mette in pausa l’asta'
  );

  return jsonb_build_object('completed', true, 'status', 'paused');
end;
$$;

revoke all on function public.complete_bid_countdown(text, text, bigint)
  from anon, authenticated;
