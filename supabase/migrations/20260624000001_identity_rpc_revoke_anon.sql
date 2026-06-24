-- Security hardening for the identity-reconciliation RPCs.
--
-- The 20260623120000_identity_reconciliation migration intended these
-- SECURITY DEFINER functions to be service_role ONLY, but its
-- `revoke all ... from public` did not remove the per-role EXECUTE that
-- Supabase's default privileges auto-grant to anon/authenticated on every new
-- function in the public schema. That left reconcile_identity (which can merge
-- and DELETE students rows, bypassing RLS) callable via the public anon key
-- through PostgREST. Explicitly revoke from those roles. service_role keeps the
-- grant from the prior migration.
revoke all on function public.reconcile_identity(uuid, text, text) from anon, authenticated;
revoke all on function public.repoint_student_fks(uuid, uuid) from anon, authenticated;
