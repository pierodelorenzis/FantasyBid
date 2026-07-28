-- Correzione della funzione atomica: qualifica la colonna version per evitare
-- l'ambiguità con il parametro di output PL/pgSQL.

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

revoke all on function public.replace_auction_snapshot(text, bigint, jsonb)
  from anon, authenticated;
