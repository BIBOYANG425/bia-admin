-- George memory consolidation — Phase 2. Drop the retired student_memories table.
-- All code reading/writing it was removed (george PR #55) and DEPLOYED before this
-- runs (migration-after-code). The 1 remaining row (a never-onboarded user with no
-- user_id, inactive since April) had no migration target and was accepted as dropped.
drop table if exists public.student_memories;
