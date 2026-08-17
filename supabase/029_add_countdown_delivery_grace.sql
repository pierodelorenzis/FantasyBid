-- Reserve two seconds for the session update to travel from Postgres through
-- the app server/SSE connection before the five visible countdown seconds.
-- Rebuild the existing function in place so its permissions remain unchanged.

do $$
declare
  v_function regprocedure := 'public.update_auction_session(text,text,text)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if v_definition like '%v_now + 5000%' then
    execute replace(v_definition, 'v_now + 5000', 'v_now + 7000');
  end if;
end;
$$;
