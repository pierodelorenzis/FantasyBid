-- Accredito atomico di crediti a una squadra partecipante.

create or replace function public.add_participant_credits(
  p_auction_code text,
  p_admin_token text,
  p_participant_token text,
  p_amount integer
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
  if p_amount is null or p_amount <= 0 then
    raise exception 'Inserisci un numero di crediti maggiore di zero';
  end if;
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

  update public.auction_participants
  set budget = budget + p_amount
  where auction_code = p_auction_code and token = p_participant_token;
  update public.auctions
  set version = version + 1, updated_at = now()
  where code = p_auction_code;
  insert into public.auction_activity (auction_code, position, name, action, amount)
  values (
    p_auction_code,
    coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
    v_administrator.name,
    'aggiunge crediti alla squadra di ' || v_participant.name,
    p_amount
  );
  return jsonb_build_object(
    'participantToken', v_participant.token,
    'participantName', v_participant.name,
    'budget', v_participant.budget + p_amount,
    'amount', p_amount,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.add_participant_credits(text, text, text, integer)
  from anon, authenticated;
