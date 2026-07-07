# Schema history archive

Inert, read-only copies of the migration SQL that **other repos** used to create
the tables shared across the BIA platform. These files exist for provenance and
archaeology only.

> **Do not apply anything in this directory.** Nothing here is a runnable
> migration. The canonical, append-only migration history lives in
> [`../../supabase/migrations/`](../../supabase/migrations/); the live Supabase
> project (`ujkaregrwrppaehvbahf`) is the ultimate source of truth.

## Why this exists — the ownership story

The shared Postgres schema was not born in this repo. Historically:

- **bia-roommate** (uscbia.com) owned and migrated most of the web-facing shared
  tables: roommate profiles, sublets, the entire shipping stack
  (`shipments` / `parcels` / `shipping_notifications` / routes / contacts /
  pack requests), squad (`找搭子`) posts, apartment comments/votes, feedback.
- **george** (the agent backend) owned and migrated the agent-facing shared
  tables: `students`, `messages`, `events`, `event_submissions`, `reminders`,
  `sublets`, campus knowledge, user profiles / heartbeat, pending users.

This repo's own baseline (`00000000000000_baseline.sql`) is deliberately a
**no-op placeholder** — it documents that the live project "already has 39 tables
defined by the uscbia.com repo's migrations + manual setup" and never re-creates
them. So for those shared tables there was, until now, **no single source of DDL
provenance**. This archive closes that gap.

**Going forward, `bia-admin` is the single owner of the migrations directory.**
bia-roommate's and george's `supabase/` directories are being removed in parallel
PRs; all new migrations for shared tables land in
[`../../supabase/migrations/`](../../supabase/migrations/) and are applied to the
live DB from here. The "source of truth" claim is true from this point on, with
the **live database (baseline)** as the starting state and these archived files
as the historical record of how that state was reached.

## Inventory

| Repo | Archived files | Source path (now being deleted) |
| --- | --- | --- |
| bia-roommate | 29 `*.sql` | `bia-roommate/supabase/migrations/` |
| george | 15 `*.sql` | `george/supabase/migrations/` |

## Which archived file created which shared table

### bia-roommate

| Archived file | Tables / objects it created |
| --- | --- |
| `20260101_roommate_profiles.sql` | `roommate_profiles` |
| `20260102_profile_likes.sql` | `profile_likes` |
| `20260103_profile_comments.sql` | `profile_comments` |
| `20260104_sublet_listings.sql` | `sublet_listings` (later merged into `sublets`) |
| `20260105_saved_schedules.sql` | `saved_schedules` |
| `20260401_course_rating.sql` | `course_reviews`, `course_rating_aggregates`, `course_lists` |
| `20260402_squad.sql` | `squad_posts`, `squad_members` |
| `20260414_consolidate_sublets.sql` | merges `sublet_listings` (web) + george's `sublets` into one `sublets` table |
| `20260419_shipping.sql` | `warehouse_addresses`, `shipments`, `parcels`, `parcel_events`, `shipping_notifications` |
| `20260419_shipping_user_link.sql` | adds `students.user_id` (auth.users ↔ students bridge) |
| `20260420_shipping_method_routes_contacts.sql` | `shipping_routes`, `shipping_contacts` |
| `20260420_shipping_sensitive_method.sql` | shipping sensitive-method columns |
| `20260421_shipping_sensitive_route_seed.sql` | seed data for sensitive routes |
| `20260422_admin_indexes.sql` | shipping admin indexes |
| `20260423_admin_parcel_rpcs.sql` | **`admin_patch_parcel`, `admin_attach_parcels_to_shipment`** (see WARNING) |
| `20260424_avatars_bucket.sql` | avatars storage bucket |
| `20260424_feedback.sql` | `feedback` |
| `20260425_roommate_contact_channels.sql` | roommate contact-channel columns |
| `20260426_roommate_profiles_grants.sql` | grants on `roommate_profiles` |
| `20260427_shipment_requests_and_frequency.sql` | `shipment_requests` |
| `20260428_pack_requests_and_qr_bucket.sql` | `pack_requests`, `pack_request_parcels`, QR bucket |
| `20260503_events_source_url_unique.sql` | unique index on `events.source_url` |
| `20260606_parcel_notification_enqueue.sql` | **`enqueue_parcel_notification()`** trigger fn (see WARNING) |
| `20260612_hide_test_roommate_profiles.sql` | test-profile hiding |
| `20260612_roommate_profiles_contact_privacy.sql` | contact-privacy columns |
| `20260612_roommate_profiles_is_test.sql` | `roommate_profiles.is_test` |
| `20260624000000_apartment_comments.sql` | `apartment_comments` |
| `20260624100000_apartment_votes.sql` | `apartment_votes` |
| `20260624120000_apartment_vote_access.sql` | apartment-vote RLS/access |

### george

| Archived file | Tables / objects it created |
| --- | --- |
| `001_george_schema.sql` | `students`, `messages`, `events`, `event_submissions`, `reminders`, `sublets`, `campus_knowledge`, `student_memories`, `event_attendance`, `student_connections`, `proactive_log` |
| `002_courses_programs.sql` | `courses`, `programs` |
| `002_onboarding_tracking.sql` | onboarding-tracking columns on `students` |
| `003_wechat_ingest_knowledge.sql` | `freshman_faq`, `course_tips` |
| `010_user_profiles.sql` | `user_profiles` (FK `students(user_id)` — see inconsistency note) |
| `011_user_heartbeat_config.sql` | `user_heartbeat_config` (FK `students(user_id)`) |
| `012_user_heartbeat_instructions.sql` | `user_heartbeat_instructions` (FK `students(user_id)`) |
| `013_heartbeat_log.sql` | `heartbeat_log` (FK `students(user_id)`) |
| `014_student_followups.sql` | `student_followups` (FK `students(user_id)`) |
| `015_pending_users.sql` | `pending_users` |
| `20260522_extend_memory_categories.sql` | memory-category extension |
| `20260611_messages_user_id_session_memory.sql` | `messages.user_id` + session-memory columns |
| `20260624_user_heartbeat_config_authenticated_insert.sql` | heartbeat-config RLS |
| `20260624_user_heartbeat_config_consent_memory.sql` | heartbeat consent-memory columns |
| `20260625_message_flags.sql` | `message_flags` |

## ⚠️ WARNING — divergent function bodies

Three functions were defined in **both** the roommate archive and this repo's
canonical migrations, and their bodies **diverge**. This repo's canonical
migrations carry the evolved, hardened definitions; the archived versions are
older and would **regress** the live function if applied.

| Function | Archived (stale) definition | Canonical definition — THE ONLY correct source |
| --- | --- | --- |
| `enqueue_parcel_notification()` | `bia-roommate/20260606_parcel_notification_enqueue.sql` | `20260606061321_parcel_notification_enqueue.sql` → `20260606061351_..._branch_states.sql` → `20260611000001_widen_shipping_notification_kinds.sql` → `20260703000004_notification_pipeline_correctness.sql` |
| `admin_patch_parcel(...)` | `bia-roommate/20260423_admin_parcel_rpcs.sql` | `20260624000001_admin_patch_parcel_stamp_received_at.sql` → `20260703000001_shipping_state_machine_hardening.sql` |
| `admin_attach_parcels_to_shipment(...)` | `bia-roommate/20260423_admin_parcel_rpcs.sql` | `20260623000001_attach_rpc_received_cn_guard.sql` → `20260624000002_admin_attach_pack_request_atomic.sql` → `20260624000005_codex_review_shipping_hardening.sql` → `20260703000001_shipping_state_machine_hardening.sql` → `20260703000006_pack_request_approve_on_batch.sql` |

**Only the `supabase/migrations/` definitions are canonical. Never apply the
archived versions of these functions — doing so silently reverts security and
correctness hardening that shipped after the archive was frozen.**

## Note — george's local set was internally inconsistent

The george archive is **provenance, not a runnable history**. Its own migrations
do not form a consistent chain:

- `001_george_schema.sql` creates `students` keyed on `id uuid PRIMARY KEY`
  (plus platform IDs `wechat_open_id` / `imessage_id`). It has **no `user_id`
  column**.
- `010_user_profiles.sql` through `014_student_followups.sql` all declare
  `user_id uuid ... REFERENCES students(user_id)` — a foreign key against a
  column george's own `001` never created.

That `students.user_id` column was actually introduced by **bia-roommate's**
`20260419_shipping_user_link.sql` (the auth.users ↔ students bridge). So george's
010–014 migrations only apply cleanly on a database that had already run
roommate's shipping-user-link migration. Running the george set in isolation from
`001` would fail. Treat these files as a record of intent, not a replayable
sequence — reconstruct real history from the live DB, not from this archive.
