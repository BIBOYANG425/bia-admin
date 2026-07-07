-- supabase/migrations/20260706000000_squad_board_for_me_delegate_resolver.sql
-- Refactor: squad_board_for_me delegates identity resolution to squad_resolve_me().
--
-- Context: squad_board_for_me (20260613000006) inlined a JIT student-provisioning
-- block identical to the one squad_resolve_me() implements (20260615120000). Having
-- two copies of the same logic means bug-fixes or policy changes must be made in
-- two places. This migration replaces the inlined block with a single call to
-- squad_resolve_me(), leaving one canonical JIT resolver in the codebase.
--
-- Behavior is equivalent or better. One nuance: squad_resolve_me() is VOLATILE
-- while the old inline block ran under this function's STABLE snapshot, so under
-- READ COMMITTED the unique_violation fallback SELECT now sees a concurrently
-- committed student row instead of possibly returning an empty board on a racing
-- first-ever call — a strict improvement. Everything else:
--   * auth.uid() == NULL  -> squad_resolve_me() raises not_authenticated (28000),
--     same as the previous inline check.
--   * student row exists  -> same UUID returned.
--   * student row absent  -> squad_resolve_me() JIT-provisions via the same INSERT
--     with the students_user_id_uidx unique_violation guard, then falls back to a
--     SELECT on conflict — same race-safe path as before.
--   * result shape        -> unchanged; still delegates to hybrid_search_posts_for_user
--     with the resolved student UUID and the same p_match_count parameter, which
--     returns an empty set when no posts match (no special NULL handling needed —
--     squad_resolve_me() never returns NULL; it either returns a UUID or raises).
-- The change is safe because squad_resolve_me() is an exact extraction of the
-- inline block: same error codes, same race-safe insert, same fallback SELECT.
--
-- Signature, return type, language, SECURITY DEFINER, search_path, and grants are
-- copied verbatim from 20260613000006_squad_board_for_me.sql.

create or replace function public.squad_board_for_me(p_match_count int default 30)
returns table (post_id uuid, rrf_score double precision, semantic_sim double precision,
               tag_overlap int, matched_tags text[], best_facet text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_student uuid;
begin
  v_student := public.squad_resolve_me();
  return query select * from hybrid_search_posts_for_user(v_student, p_match_count);
end;
$$;

revoke all on function public.squad_board_for_me(int) from public, anon;
grant execute on function public.squad_board_for_me(int) to authenticated, service_role;
