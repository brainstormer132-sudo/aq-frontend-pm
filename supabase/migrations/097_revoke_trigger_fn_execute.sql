-- ============================================================
-- 097_revoke_trigger_fn_execute.sql
-- Advisor: SECURITY DEFINER functions executable by anon/authenticated.
-- Trigger functions (RETURNS trigger) are fired by the trigger system as the
-- table owner - the invoking role never needs EXECUTE, and PostgREST does not
-- expose trigger-return functions as RPC anyway. So revoke EXECUTE from
-- public/anon/authenticated on every trigger function in public. This clears
-- the advisor rows for them without any behaviour change: the triggers still
-- fire for every user.
--
-- Self-adjusting (targets pg_proc where prorettype = trigger), so it also
-- covers any trigger function added later. Safe to run twice.
-- Run in staging, then prod. Then: notify pgrst.
-- ============================================================

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;