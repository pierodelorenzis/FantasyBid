-- Allow an administrator to replace a team's total budget, increasing or
-- reducing it without ever going below credits already committed to players.

create or replace function public.set_participant_budget(
  p_auction_code text,
  p_admin_token text,
  p_participant_token text,
  p_budget integer
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

  if p_budget is null or p_budget < v_participant.committed then
    raise exception 'Il budget non può essere inferiore ai % crediti già impegnati', v_participant.committed;
  end if;
  if p_budget = v_participant.budget then
    raise exception 'Il budget inserito è uguale a quello attuale';
  end if;

  update public.auction_participants
  set budget = p_budget
  where auction_code = p_auction_code and token = p_participant_token;

  update public.auctions
  set version = version + 1, updated_at = now()
  where code = p_auction_code;

  insert into public.auction_activity (auction_code, position, name, action, amount)
  values (
    p_auction_code,
    coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
    v_administrator.name,
    'imposta il budget della squadra di ' || v_participant.name,
    p_budget
  );

  return jsonb_build_object(
    'participantToken', v_participant.token,
    'participantName', v_participant.name,
    'budget', p_budget,
    'previousBudget', v_participant.budget,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.set_participant_budget(text, text, text, integer)
  from anon, authenticated;

drop function if exists public.add_participant_credits(text, text, text, integer);
