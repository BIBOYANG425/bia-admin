# Parcel Notification Runbook (george consumer · Phase 1a B2)

**Status:** producer applied to Supabase 2026-06-06 (migrations
`20260606061321_parcel_notification_enqueue` +
`20260606061351_parcel_notification_enqueue_branch_states`).
Consumer (george cron) is the remaining work.

> ⚠️ **Known schema gap (fix pending apply):** the branch-states migration
> enqueues kinds `lost`/`returned`/`disputed`, but the `kind` CHECK constraint
> (created inline in bia-roommate `20260419_shipping.sql`) only allows the
> original 7 kinds. If the 7-kind function body is live, marking a parcel
> lost/returned/disputed aborts the officer's UPDATE with a check_violation
> (hard 500). Migration `20260611000001_widen_shipping_notification_kinds.sql`
> widens the CHECK; apply it (and run its verification SQL) before relying on
> branch-state transitions.

> ⚠️ **Do NOT apply the bia-roommate copy of
> `20260606_parcel_notification_enqueue.sql` now.** That copy has the older
> 4-kind function body (no lost/returned/disputed). Because it uses
> `CREATE OR REPLACE FUNCTION`, applying it would silently downgrade the
> live 7-kind producer back to 4 kinds. The producer's source of truth is
> `bia-admin/supabase/migrations/` only.

**Owners:**
- Producer: lives in `bia-admin/supabase/migrations/`. Source of truth.
- Consumer: lives in `BIBOYANG425/george` (Express + Node, Docker).

## What the producer does

A trigger on `public.parcels` enqueues one row into
`public.shipping_notifications` (status `pending`, `scheduled_for now()`,
deduped per `<parcel_id>:<kind>`) whenever `parcels.status` transitions
into one of seven kinds:

| Kind | Parcel status | Audience reaction |
|---|---|---|
| `received_cn` | `received_cn` (仓库签收) | "BIA got my package" |
| `in_transit` | `in_transit` (国际段) | "It's on the way" |
| `arrived_us` | `arrived_us` (到达美国) | "Action: pickup soon" |
| `picked_up_thanks` | `picked_up` (已取件) | "Thank-you / loop-close" |
| `lost` | `lost` (丢失) | Bad news — handle with care |
| `returned` | `returned` (退回) | Bad news — handle with care |
| `disputed` | `disputed` (待核实) | Needs human follow-up |

The `expected` status does not enqueue. Status reversions (e.g. `in_transit`
→ `received_cn`) re-enqueue with a different `kind`, so dedup is per
(parcel, kind) — never duplicated, but the lifecycle can produce all 7
kinds for the same parcel if it really takes that journey.

## What george actually does (shipped consumer behavior)

Implemented in `george/src/jobs/shipping-notifier.ts` +
`george/src/db/shipping-notifications.ts`. Per cron tick:

1. **Read a batch (no claim step).** Select up to 100 rows with
   `status='pending' AND scheduled_for <= now()`, ordered by `scheduled_for`,
   joining `students` for the delivery platform id. There is no intermediate
   "claiming" status — the `status` CHECK only allows
   `pending / sent / failed / skipped`.
2. **Resolve copy by kind.** Static bilingual copy lives in the job's
   `MESSAGES` map. ⚠️ As of 2026-06-11 it only covers the 4 happy-path kinds
   (`received_cn`, `in_transit`, `arrived_us`, `picked_up_thanks`);
   `lost`/`returned`/`disputed` rows get `status='skipped'`,
   `error='no_copy_for_kind'`.
3. **Resolve the platform.** Prefer `students.wechat_open_id` (WeChat
   customer-service message), else `students.imessage_id`. Missing student →
   `skipped` / `no_student`; no platform id → `skipped` / `no_platform_id`.
   (There is no `no_openid` status — it is not in the status CHECK.)
4. **Send once via `sendPlatformMessage`** (same path as reminder-sender).
   Success → `status='sent'`, `sent_at=now()`. Any send error →
   `status='failed'`, `error=<message>` — **terminal**. Single attempt, no
   retry, no retry counter, no `dead` status.

### ⚠️ 未实现 — claim protocol (future schema change)

An earlier draft of this runbook specified a claim step
(`SET status='sending' ... FOR UPDATE SKIP LOCKED`) plus a `no_openid`
status and a retry-cap-3 → `dead` flow. **None of that is implementable
against the current schema**: the `status` CHECK constraint allows only
`pending / sent / failed / skipped`, and there is no retry-count column.
Treat claim/lease semantics, retries, and a dead-letter status as a future
schema change (widen the status CHECK + add `retry_count`), not as current
behavior. Until then george must run as a single instance (no SKIP LOCKED
concurrency protection).

## Safety filters — planned, ⚠️ 未实现

**As of 2026-06-11 NONE of these filters exist in george's code.** The
shipped consumer sends every pending row that has copy and a platform id.
Each item below is a design spec for future work, not current behavior —
do not assume any of them protects production.

1. ⚠️ 未实现 — **Per-user daily cap.** If the student has 10 sent
   notifications in the trailing 24h, skip with reason `daily_cap`. Backed
   by a count on `shipping_notifications` where `status='sent'` and
   `sent_at > now() - interval '24 hours'`.
2. ⚠️ 未实现 — **Quiet hours.** If current time in Los Angeles is
   23:00–08:00, defer: `UPDATE shipping_notifications SET scheduled_for =
   (next 08:00 PT) WHERE id=$1`. Do NOT mark sent.
3. ⚠️ 未实现 — **Branch-state delay.** If `kind IN
   ('lost','returned','disputed')`, hold the row ~15 minutes after enqueue
   so an officer can intercept manually (e.g. set
   `scheduled_for = created_at + interval '15 minutes'` on first sweep).
   Today these kinds are skipped anyway (`no_copy_for_kind`), so the delay
   must land together with their copy.
4. ⚠️ 未实现 — **Opt-out.** If `students.parcel_notifications_opted_out =
   true`, skip with reason `opted_out`. (Column does not exist yet either —
   see Opt-out implementation below.)
5. ⚠️ 未实现 — **48h freshness.** WeChat 客服消息 only works for users
   active in the past 48h. Check `students.last_wechat_interaction_at`; if
   older, skip with reason `wechat_stale_48h`. (Covered by template
   messages in Phase 1b / handoff #6.)

Likewise, retry-with-cap (3 attempts then `dead`) is ⚠️ 未实现 — see the
claim-protocol note above; today a failed send is terminal `failed`.

## Copy templates (bilingual)

> Note: these are the **target** templates. The shipped consumer currently
> uses shorter static one-liners (the `MESSAGES` map in
> `george/src/jobs/shipping-notifier.ts`) with no `{description}`/`{method}`
> interpolation, and has no copy at all for `lost`/`returned`/`disputed`.
> The "(branch state, 15 min delay)" labels below refer to safety filter #3,
> which is ⚠️ 未实现.

Variables: `{description}` from `parcels.description`,
`{method}` from `SHIPPING_METHOD_META[parcels.shipping_method].label`.

### `received_cn` — 仓库签收
```
📦 BIA 集运 · 仓库已签收
你的包裹「{description}」已到达中国仓库,等下一班国际段。

BIA Shipping · Received at CN warehouse
"{description}" arrived. Waiting for the next international leg.

回复 N 退订包裹通知 · Reply N to unsubscribe
```

### `in_transit` — 国际段运输
```
✈️ BIA 集运 · 已发货
「{description}」已上国际段({method}),一般 7-14 天到。

BIA Shipping · In transit
"{description}" is on the way ({method}). Usually 7-14 days.

回复 N 退订包裹通知 · Reply N to unsubscribe
```

### `arrived_us` — 到达美国
```
🇺🇸 BIA 集运 · 到达美国
「{description}」已到 BIA 美国站点。取件信息会单独通知,请留意微信群。

BIA Shipping · Arrived in US
"{description}" landed at BIA US station. Pickup details coming next.

回复 N 退订包裹通知 · Reply N to unsubscribe
```

### `picked_up_thanks` — 已取件
```
✅ BIA 集运 · 已签收
「{description}」交付成功,谢谢使用 BIA 集运 🙏

BIA Shipping · Picked up
Delivery confirmed for "{description}". Thanks for shipping with BIA 🙏

回复 N 退订包裹通知 · Reply N to unsubscribe
```

### `lost` — 丢失 (branch state, 15 min delay)
```
⚠️ BIA 集运 · 包裹丢失
「{description}」运输途中丢失,BIA 运营会尽快和你联系跟进理赔。

BIA Shipping · Parcel lost
"{description}" was lost in transit. A BIA officer will reach out shortly to start the claim.

回复 N 退订包裹通知 · Reply N to unsubscribe
```

### `returned` — 退回 (branch state, 15 min delay)
```
↩️ BIA 集运 · 包裹退回
「{description}」被退回,详情请查看仓库备注或联系 BIA 运营。

BIA Shipping · Parcel returned
"{description}" was returned. Check the warehouse notes or contact a BIA officer.

回复 N 退订包裹通知 · Reply N to unsubscribe
```

### `disputed` — 待核实 (branch state, 15 min delay)
```
🔍 BIA 集运 · 待核实
「{description}」需要进一步核实,BIA 运营会和你确认细节。

BIA Shipping · Pending verification
"{description}" needs follow-up. A BIA officer will confirm details with you.

回复 N 退订包裹通知 · Reply N to unsubscribe
```

## Opt-out implementation

Two surfaces, both write to `students.parcel_notifications_opted_out`:

**A. Footer reply (george).** When a WeChat reply is `N` / `n` /
`退订` / `unsubscribe` AND the user's most recent received notification
is a parcel notification (look at `shipping_notifications` by
`student_id`), set `students.parcel_notifications_opted_out = true` and
reply confirmation:
> ✅ 已退订 BIA 集运通知。如需重新订阅,回复 Y。
> Unsubscribed from BIA shipping notifications. Reply Y to re-subscribe.

**B. Dashboard toggle (uscbia.com).** A settings page on
`uscbia.com/account` that flips the same column. This work lives in
`bia-roommate` and is out of scope for george.

**Note:** the `parcel_notifications_opted_out` column does not exist yet
on `students`. A follow-up migration in this repo needs to add it
(`ALTER TABLE public.students ADD COLUMN parcel_notifications_opted_out
boolean NOT NULL DEFAULT false;`) before george can read it. I'd
recommend doing that in the same PR that lands these runbook docs.

## Deploy steps (Bobby)

1. **FIRST: triage the pending backlog before george ever starts against
   prod.** The producer trigger has been live since 2026-06-06, so
   `shipping_notifications` has been silently accumulating `pending` rows
   with no consumer. The moment george's cron starts, it will try to send
   ALL of them — days-old status updates would blast students at once.
   Inspect, then mark everything stale as `skipped`:

   ```sql
   -- Inspect: what has piled up since 2026-06-06?
   SELECT kind, status, count(*),
          min(created_at) AS oldest, max(created_at) AS newest
   FROM public.shipping_notifications
   GROUP BY 1, 2
   ORDER BY 1, 2;

   -- Inspect: the exact pending rows george would send on its first tick
   SELECT id, kind, student_id, parcel_id, created_at, scheduled_for
   FROM public.shipping_notifications
   WHERE status = 'pending' AND scheduled_for <= now()
   ORDER BY created_at ASC;

   -- Purge: mark stale pre-go-live rows skipped (pick the cutoff
   -- deliberately — usually "everything created before the moment you
   -- deploy"). Additive status flip; no rows deleted.
   UPDATE public.shipping_notifications
   SET status = 'skipped', error = 'stale_backlog_pre_go_live'
   WHERE status = 'pending'
     AND created_at < '<go-live cutoff, e.g. 2026-06-11T00:00:00Z>';
   ```

2. **Apply `20260611000001_widen_shipping_notification_kinds.sql`** (and
   run its verification SQL) so branch-state transitions can't abort
   officer updates.
3. **Add the opt-out column** by applying a follow-up migration (call it
   `20260606_students_parcel_opt_out.sql`). Until then, george should
   treat the opt-out filter as a no-op (always-`false` fallback).
4. **Pull `BIBOYANG425/george` `main`** and confirm the parcel
   notification cron is implemented. Spec is this file.
5. **Set env vars on george** (none new required if it already has
   `SUPABASE_SERVICE_ROLE_KEY` and the WeChat OA credentials).
6. **Redeploy george** the usual way (Docker image rebuild + restart).
7. **Verify** (see below).

## Verification

Smoke test against a real but contained parcel:

```sql
-- as super_admin in Supabase SQL editor
UPDATE public.parcels
SET status = 'received_cn'
WHERE id = '<a test parcel ID with a known student_id>';

-- confirm enqueue
SELECT id, kind, status, scheduled_for
FROM public.shipping_notifications
WHERE parcel_id = '<that parcel ID>'
ORDER BY created_at DESC LIMIT 5;
```

Expected: one row with `kind='received_cn'`, `status='pending'`.

Then watch george logs for ~6 min; the row should flip to `sent` with
`sent_at` set. WeChat OA should show a sent customer-service message to
the test student. If the test student is yourself (Bobby's wxid), you'll
see it in WeChat.

Re-run the UPDATE with `status='in_transit'`. A new row enqueues
(different `kind`), the previous one stays `sent`.

## Rollback

The trigger is purely additive. To rollback:

```sql
DROP TRIGGER IF EXISTS trg_parcels_enqueue_notification ON public.parcels;
DROP FUNCTION IF EXISTS public.enqueue_parcel_notification();
```

No data is destroyed. `shipping_notifications` rows already enqueued
remain; george can either drain them or you can `DELETE` them safely.

## Hand-back

When george is deployed and the smoke test passes end-to-end, the loop
is closed for handoff #2. Combined with the privacy notice (PR #7,
Phase 0 A1) and PostHog wiring already on main (Phase 0 A2),
admin-side retention is fully wired. Remaining: uscbia.com analytics
hookup (handoff bia-roommate side) and WeChat template messages (#6,
external审批).
