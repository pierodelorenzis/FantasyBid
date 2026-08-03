-- Rigenera la credenziale amministratore senza modificare le sessioni dei
-- partecipanti. Anche gli snapshot della cronologia vengono aggiornati, così
-- un successivo annullamento non può ripristinare il vecchio token.

create or replace function public.rotate_admin_token(
  p_auction_code text,
  p_new_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_administrator public.auction_participants%rowtype;
begin
  if coalesce(trim(p_new_token), '') = '' then
    raise exception 'Nuovo token non valido';
  end if;

  select * into v_administrator
  from public.auction_participants
  where auction_code = p_auction_code and role = 'admin'
  for update;
  if not found then raise exception 'Amministratore non trovato'; end if;

  if exists (
    select 1 from public.auction_participants
    where auction_code = p_auction_code and token = p_new_token
  ) then
    raise exception 'Token già utilizzato';
  end if;

  if exists (
    select 1 from public.roster_players
    where auction_code = p_auction_code
      and participant_token = v_administrator.token
  ) then
    raise exception 'Stato amministratore non valido';
  end if;

  update public.auction_participants
  set token = p_new_token
  where auction_code = p_auction_code and token = v_administrator.token;

  update public.auction_history as history
  set snapshot = jsonb_set(
    history.snapshot,
    '{participants}',
    coalesce(
      (
        select jsonb_agg(
          case
            when participant.value ->> 'role' = 'admin'
              and participant.value ->> 'token' = v_administrator.token
            then jsonb_set(
              participant.value,
              '{token}',
              to_jsonb(p_new_token)
            )
            else participant.value
          end
          order by participant.ordinality
        )
        from jsonb_array_elements(history.snapshot -> 'participants')
          with ordinality as participant(value, ordinality)
      ),
      '[]'::jsonb
    )
  )
  where history.auction_code = p_auction_code
    and jsonb_typeof(history.snapshot -> 'participants') = 'array';

  return jsonb_build_object(
    'code', p_auction_code,
    'previousToken', v_administrator.token,
    'token', p_new_token
  );
end;
$$;

revoke all on function public.rotate_admin_token(text, text)
  from anon, authenticated;
