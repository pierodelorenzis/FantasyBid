-- Gestione atomica dello stato dell'asta e dei countdown. Il completamento
-- del countdown è separato dalla sua pianificazione per mantenere il timer
-- visibile a tutti i client durante i cinque secondi di attesa.

create or replace function public.update_auction_session(
  p_auction_code text,
  p_admin_token text,
  p_action text
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
  v_countdown_ends_at bigint;
begin
  if p_action not in (
    'pause',
    'schedule_start',
    'schedule_pause',
    'complete_start',
    'complete_pause'
  ) then
    raise exception 'Azione sessione non valida';
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

  if p_action = 'pause' then
    if v_auction.status <> 'live' then
      raise exception 'L’asta è già in pausa';
    end if;
    update public.auctions
    set
      status = 'paused',
      countdown_ends_at = null,
      start_countdown_ends_at = null,
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
  elsif p_action = 'schedule_start' then
    if v_auction.status <> 'paused' then
      raise exception 'L’asta è già attiva';
    end if;
    if v_auction.start_countdown_ends_at is not null
      and v_auction.start_countdown_ends_at > v_now then
      raise exception 'Avvio dell’asta già programmato';
    end if;
    -- Five visible seconds plus two seconds for the update to reach every
    -- browser before the shared countdown starts.
    v_countdown_ends_at := v_now + 7000;
    update public.auctions
    set
      start_countdown_ends_at = v_countdown_ends_at,
      countdown_ends_at = null,
      version = version + 1,
      updated_at = now()
    where code = p_auction_code;
  elsif p_action = 'schedule_pause' then
    if v_auction.status <> 'live' then
      raise exception 'L’asta non è attiva';
    end if;
    if v_auction.countdown_ends_at is not null
      and v_auction.countdown_ends_at > v_now then
      raise exception 'Countdown già attivo';
    end if;
    v_countdown_ends_at := v_now + 7000;
    update public.auctions
    set
      countdown_ends_at = v_countdown_ends_at,
      version = version + 1,
      updated_at = now()
    where code = p_auction_code;
  elsif p_action = 'complete_start' then
    if v_auction.start_countdown_ends_at is null then
      raise exception 'Nessun avvio programmato';
    end if;
    if v_auction.start_countdown_ends_at > v_now then
      raise exception 'Il countdown di avvio non è terminato';
    end if;
    update public.auctions
    set
      status = 'live',
      start_countdown_ends_at = null,
      version = version + 1,
      updated_at = now()
    where code = p_auction_code;

    insert into public.auction_activity (auction_code, position, name, action)
    values (
      p_auction_code,
      coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0),
      v_administrator.name,
      'avvia l’asta'
    );
  elsif p_action = 'complete_pause' then
    if v_auction.countdown_ends_at is null then
      raise exception 'Nessun countdown di pausa attivo';
    end if;
    if v_auction.countdown_ends_at > v_now then
      raise exception 'Il countdown di pausa non è terminato';
    end if;
    update public.auctions
    set
      status = 'paused',
      countdown_ends_at = null,
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
  end if;

  return jsonb_build_object(
    'action', p_action,
    'status', case
      when p_action = 'complete_start' then 'live'
      when p_action in ('pause', 'complete_pause') then 'paused'
      else v_auction.status
    end,
    'countdownEndsAt', case
      when p_action = 'schedule_pause' then v_countdown_ends_at
      else null
    end,
    'startCountdownEndsAt', case
      when p_action = 'schedule_start' then v_countdown_ends_at
      else null
    end,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.update_auction_session(text, text, text)
  from anon, authenticated;
