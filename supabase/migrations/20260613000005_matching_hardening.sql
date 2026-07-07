-- Squad Phase 0 hardening (CodeRabbit PR #16):
-- 1) Unique guard so JIT student provisioning can't race into duplicate rows
--    (check-then-insert window in resolveStudentId; verified no existing dupes).
-- 2) Domain constraints on user_match_prefs so invalid prefs can't persist.

create unique index if not exists students_user_id_uidx
  on public.students (user_id) where user_id is not null;

alter table public.user_match_prefs
  add constraint user_match_prefs_cap_check check (weekly_ping_cap >= 0),
  add constraint user_match_prefs_quiet_start_check check (quiet_start_hour between 0 and 23),
  add constraint user_match_prefs_quiet_end_check check (quiet_end_hour between 0 and 23),
  add constraint user_match_prefs_channel_check check (channel in ('imessage','web','email'));
