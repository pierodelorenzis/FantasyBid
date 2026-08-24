-- Timer ordinario delle puntate. E' distinto da countdown_ends_at, riservato
-- a "Ultima chiamata", che ha sempre la precedenza e mette l'asta in pausa.

alter table public.auctions
  add column if not exists bid_duration_seconds integer not null default 30
    check (bid_duration_seconds between 5 and 300),
  add column if not exists bid_countdown_ends_at bigint;

create or replace function public.clear_bid_countdown_when_paused()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'paused' then new.bid_countdown_ends_at := null; end if;
  return new;
end;
$$;

drop trigger if exists clear_bid_countdown_when_paused on public.auctions;
create trigger clear_bid_countdown_when_paused
before insert or update on public.auctions
for each row execute function public.clear_bid_countdown_when_paused();

create or replace function public.set_bid_duration(
  p_auction_code text,
  p_admin_token text,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version bigint;
begin
  if p_duration_seconds < 5 or p_duration_seconds > 300 then
    raise exception 'La durata delle puntate deve essere tra 5 e 300 secondi';
  end if;
  if not exists (
    select 1 from public.auction_participants
    where auction_code = p_auction_code
      and token = p_admin_token
      and role = 'admin'
  ) then
    raise exception 'Operazione riservata all’admin';
  end if;

  update public.auctions
  set
    bid_duration_seconds = p_duration_seconds,
    bid_countdown_ends_at = case
      when status = 'live' and countdown_ends_at is null
        then floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          + p_duration_seconds * 1000 + 2000
      else bid_countdown_ends_at
    end,
    version = version + 1,
    updated_at = now()
  where code = p_auction_code
  returning version into v_version;
  if not found then raise exception 'Asta non trovata'; end if;

  return jsonb_build_object(
    'bidDurationSeconds', p_duration_seconds,
    'version', v_version
  );
end;
$$;

revoke all on function public.set_bid_duration(text, text, integer)
  from anon, authenticated;

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
  v_bid_countdown_ends_at bigint;
begin
  if p_action not in ('pause', 'schedule_start', 'schedule_pause', 'complete_start', 'complete_pause') then
    raise exception 'Azione sessione non valida';
  end if;

  select * into v_auction from public.auctions
  where code = p_auction_code for update;
  if not found then raise exception 'Asta non trovata'; end if;

  select * into v_administrator from public.auction_participants
  where auction_code = p_auction_code and token = p_admin_token and role = 'admin'
  for update;
  if not found then raise exception 'Operazione riservata all’admin'; end if;

  if p_action = 'pause' then
    if v_auction.status <> 'live' then raise exception 'L’asta è già in pausa'; end if;
    update public.auctions set
      status = 'paused', countdown_ends_at = null,
      start_countdown_ends_at = null, bid_countdown_ends_at = null,
      version = version + 1, updated_at = now()
    where code = p_auction_code;
    insert into public.auction_activity (auction_code, position, name, action)
    values (p_auction_code, coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0), v_administrator.name, 'mette in pausa l’asta');

  elsif p_action = 'schedule_start' then
    if v_auction.status <> 'paused' then raise exception 'L’asta è già attiva'; end if;
    if v_auction.start_countdown_ends_at is not null and v_auction.start_countdown_ends_at > v_now then
      raise exception 'Avvio dell’asta già programmato';
    end if;
    v_countdown_ends_at := v_now + 7000;
    update public.auctions set
      start_countdown_ends_at = v_countdown_ends_at,
      countdown_ends_at = null, bid_countdown_ends_at = null,
      version = version + 1, updated_at = now()
    where code = p_auction_code;

  elsif p_action = 'schedule_pause' then
    if v_auction.status <> 'live' then raise exception 'L’asta non è attiva'; end if;
    if v_auction.countdown_ends_at is not null and v_auction.countdown_ends_at > v_now then
      raise exception 'Countdown già attivo';
    end if;
    v_countdown_ends_at := v_now + 7000;
    update public.auctions set
      countdown_ends_at = v_countdown_ends_at,
      bid_countdown_ends_at = null,
      version = version + 1, updated_at = now()
    where code = p_auction_code;

  elsif p_action = 'complete_start' then
    if v_auction.start_countdown_ends_at is null then raise exception 'Nessun avvio programmato'; end if;
    if v_auction.start_countdown_ends_at > v_now then raise exception 'Il countdown di avvio non è terminato'; end if;
    v_bid_countdown_ends_at := v_now + v_auction.bid_duration_seconds * 1000 + 2000;
    update public.auctions set
      status = 'live', start_countdown_ends_at = null,
      bid_countdown_ends_at = v_bid_countdown_ends_at,
      version = version + 1, updated_at = now()
    where code = p_auction_code;
    insert into public.auction_activity (auction_code, position, name, action)
    values (p_auction_code, coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0), v_administrator.name, 'avvia l’asta');

  elsif p_action = 'complete_pause' then
    if v_auction.countdown_ends_at is null then raise exception 'Nessun countdown di pausa attivo'; end if;
    if v_auction.countdown_ends_at > v_now then raise exception 'Il countdown di pausa non è terminato'; end if;
    update public.auctions set
      status = 'paused', countdown_ends_at = null,
      bid_countdown_ends_at = null,
      version = version + 1, updated_at = now()
    where code = p_auction_code;
    insert into public.auction_activity (auction_code, position, name, action)
    values (p_auction_code, coalesce((select max(position) + 1 from public.auction_activity where auction_code = p_auction_code), 0), v_administrator.name, 'mette in pausa l’asta');
  end if;

  return jsonb_build_object(
    'action', p_action,
    'status', case when p_action = 'complete_start' then 'live' when p_action in ('pause', 'complete_pause') then 'paused' else v_auction.status end,
    'countdownEndsAt', case when p_action = 'schedule_pause' then v_countdown_ends_at else null end,
    'startCountdownEndsAt', case when p_action = 'schedule_start' then v_countdown_ends_at else null end,
    'bidCountdownEndsAt', case when p_action = 'complete_start' then v_bid_countdown_ends_at else null end,
    'version', v_auction.version + 1
  );
end;
$$;

revoke all on function public.update_auction_session(text, text, text)
  from anon, authenticated;

create or replace function public.cancel_pause_countdown_after_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.highest_bid_amount is distinct from old.highest_bid_amount
    and new.highest_bid_amount is not null then
    update public.auctions
    set
      countdown_ends_at = case
        when countdown_ends_at is not null
          then floor(extract(epoch from clock_timestamp()) * 1000)::bigint + 7000
        else null
      end,
      bid_countdown_ends_at = case
        when countdown_ends_at is not null then null
        when status = 'live'
          then floor(extract(epoch from clock_timestamp()) * 1000)::bigint
            + bid_duration_seconds * 1000 + 2000
        else null
      end
    where code = new.auction_code;
  end if;
  return new;
end;
$$;
