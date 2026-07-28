-- Fase 1 della migrazione: salva ogni asta completa in una riga JSONB.
-- Il formato coincide con l'attuale struttura di data.json, così possiamo
-- verificare l'importazione senza modificare ancora l'asta live.

create table if not exists public.auction_snapshots (
  code text primary key,
  state jsonb not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.auction_snapshots enable row level security;

-- Aggiornamento atomico da usare nella fase successiva. L'aggiornamento
-- riesce soltanto se la versione letta dal server coincide con quella salvata.
create or replace function public.replace_auction_snapshot(
  p_code text,
  p_expected_version bigint,
  p_state jsonb
)
returns table (version bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.auction_snapshots
  set
    state = p_state,
    version = auction_snapshots.version + 1,
    updated_at = now()
  where auction_snapshots.code = p_code
    and auction_snapshots.version = p_expected_version
  returning auction_snapshots.version, auction_snapshots.updated_at;
end;
$$;

revoke all on public.auction_snapshots from anon, authenticated;
revoke all on function public.replace_auction_snapshot(text, bigint, jsonb)
  from anon, authenticated;
