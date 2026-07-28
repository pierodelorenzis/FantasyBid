-- Ingresso atomico di un partecipante. Se il nome esiste già viene restituita
-- la stessa sessione; altrimenti partecipante e versione dell'asta nascono
-- nella medesima transazione.

create or replace function public.join_auction(
  p_auction_code text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_participant public.auction_participants%rowtype;
  v_name text := trim(p_name);
  v_token text;
begin
  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 50 then
    raise exception 'Nome partecipante non valido';
  end if;

  select * into v_auction
  from public.auctions
  where code = p_auction_code
  for update;
  if not found then
    raise exception 'Asta non trovata';
  end if;

  select * into v_participant
  from public.auction_participants
  where auction_code = p_auction_code
    and lower(name) = lower(v_name);
  if found then
    if v_participant.role = 'admin' then
      raise exception 'Scegli un nome partecipante diverso dall’admin';
    end if;
    return jsonb_build_object(
      'token', v_participant.token,
      'name', v_participant.name,
      'created', false,
      'version', v_auction.version
    );
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into public.auction_participants (
    auction_code,
    token,
    name,
    role,
    budget,
    committed
  ) values (
    p_auction_code,
    v_token,
    v_name,
    'participant',
    v_auction.budget,
    0
  );

  update public.auctions
  set version = version + 1, updated_at = now()
  where code = p_auction_code;

  return jsonb_build_object(
    'token', v_token,
    'name', v_name,
    'created', true,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.join_auction(text, text)
  from anon, authenticated;
