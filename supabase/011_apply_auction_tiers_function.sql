-- Salvataggio atomico delle fasce e ricalcolo delle fasce dei giocatori.

create or replace function public.apply_auction_tiers(
  p_auction_code text,
  p_admin_token text,
  p_action text,
  p_tiers jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_administrator public.auction_participants%rowtype;
  v_tier_settings jsonb;
  v_rules jsonb;
  v_tier_count integer;
begin
  if p_action not in ('save', 'recalculate') then
    raise exception 'Azione fasce non valida';
  end if;

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

  if p_action = 'save' then
    if p_tiers is null or jsonb_typeof(p_tiers) <> 'array'
      or jsonb_array_length(p_tiers) = 0 then
      raise exception 'Inserisci almeno una fascia';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_tiers) as tier(value)
      where upper(trim(tier.value ->> 'name')) !~ '^[A-Z0-9]{1,8}$'
        or (tier.value ->> 'minQuote')::integer < 0
        or (tier.value ->> 'minPrice')::integer < 0
        or (tier.value ->> 'increment')::integer < 0
        or (tier.value ->> 'cap')::integer < 0
    ) then
      raise exception 'Valori della fascia non validi';
    end if;
    select count(*) into v_tier_count
    from jsonb_array_elements(p_tiers);
    if v_tier_count <> (
      select count(distinct upper(trim(value ->> 'name')))
      from jsonb_array_elements(p_tiers) as tier(value)
    ) then
      raise exception 'Nome fascia non valido o duplicato';
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'name', name,
        'minQuote', min_quote,
        'minPrice', min_price,
        'increment', increment,
        'cap', cap
      ) order by min_quote desc
    ) into v_tier_settings
    from (
      select
        upper(trim(value ->> 'name')) as name,
        (value ->> 'minQuote')::integer as min_quote,
        (value ->> 'minPrice')::integer as min_price,
        (value ->> 'increment')::integer as increment,
        (value ->> 'cap')::integer as cap
      from jsonb_array_elements(p_tiers) as tier(value)
    ) normalized;
  else
    v_tier_settings := v_auction.tier_settings;
  end if;

  select jsonb_object_agg(
    value ->> 'name',
    jsonb_build_object(
      'minPrice', (value ->> 'minPrice')::integer,
      'increment', (value ->> 'increment')::integer,
      'cap', (value ->> 'cap')::integer
    )
  ) into v_rules
  from jsonb_array_elements(v_tier_settings) as tier(value);

  with recalculated as (
    select
      player.id,
      (
        select value ->> 'name'
        from jsonb_array_elements(v_tier_settings) as tier(value)
        where player.quote >= (value ->> 'minQuote')::integer
        order by (value ->> 'minQuote')::integer desc
        limit 1
      ) as tier
    from public.auction_players player
    where player.auction_code = p_auction_code
  )
  update public.auction_players player
  set tier = recalculated.tier
  from recalculated
  where player.auction_code = p_auction_code
    and player.id = recalculated.id;

  update public.auctions
  set
    tier_settings = v_tier_settings,
    rules = v_rules,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code;

  if p_action = 'recalculate' then
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
      'ricalcola le fasce dei giocatori'
    );
  end if;

  return jsonb_build_object(
    'tierSettings', v_tier_settings,
    'rules', v_rules,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.apply_auction_tiers(text, text, text, jsonb)
  from anon, authenticated;
