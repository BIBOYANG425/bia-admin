-- Fix: reconcile_identity RETURNS TABLE(student_id, user_id) makes `user_id` an
-- output variable that collides with students.user_id in the function body, so it
-- throws "column reference user_id is ambiguous" at runtime whenever it resolves an
-- auth row (the auth/email path bia-roommate's profile-submit uses). The phone-only
-- path (v_auth null) skipped that branch, which is why it wasn't caught earlier.
--
-- Re-create the existing function (from 20260623120000_identity_reconciliation) with
-- the standard plpgsql directive `#variable_conflict use_column` so ambiguous
-- identifiers resolve to the column. The output params are used only in the
-- positional RETURN, so this is safe and callers' .student_id/.user_id names are
-- unchanged. CREATE OR REPLACE preserves ownership + grants (service_role-only).
-- Idempotent (no-op if the directive is already present).
do $fix$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.reconcile_identity(uuid,text,text)'::regprocedure);
  if position('#variable_conflict' in v_def) = 0 then
    v_def := regexp_replace(v_def, '(AS \$function\$)', E'\\1\n#variable_conflict use_column');
    execute v_def;
  end if;
end
$fix$;
