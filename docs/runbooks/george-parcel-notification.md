# Parcel Notification Runbook (george consumer · Phase 1a B2)

**Status:** producer applied to Supabase 2026-06-06 (migrations
`20260606061321_parcel_notification_enqueue` +
`20260606061351_parcel_notification_enqueue_branch_states`).
Consumer (george cron) is the remaining work.

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

## What george needs to do

Every 5 minutes, run this loop:

1. **Claim a batch.** `UPDATE shipping_notifications SET status='sending'
   WHERE id IN (SELECT id FROM shipping_notifications WHERE status='pending'
   AND scheduled_for <= now() ORDER BY scheduled_for ASC LIMIT 50 FOR
   UPDATE SKIP LOCKED) RETURNING *;`
2. For each claimed row, **apply the safety filters** (below). If a filter
   skips it, set `status='skipped'` and `error='<reason>'`.
3. Resolve the student's WeChat openid by joining `students` on
   `student_id`. If no openid, mark `status='no_openid'` and continue.
4. **Look up parcel description** for the message body (`parcels.description`,
   `parcels.shipping_method`).
5. **Render the message** using the templates below.
6. **Send via the existing WeChat customer-service channel.** Same code path
   george already uses for other notifications.
7. On success: `UPDATE shipping_notifications SET status='sent',
   sent_at=now() WHERE id=$1`. On failure: `status='failed', error=$err`,
   leave for retry by next tick (george should cap retries at 3 then mark
   `dead`).

## Safety filters (apply in order)

1. **Per-user daily cap.** If the student has 10 sent notifications in
   the trailing 24h, skip with reason `daily_cap`. Backed by a count
   on `shipping_notifications` where `status='sent'` and
   `sent_at > now() - interval '24 hours'`.
2. **Quiet hours.** If current time in Los Angeles is 23:00–08:00, defer:
   `UPDATE shipping_notifications SET scheduled_for = (next 08:00 PT)
   WHERE id=$1`. Do NOT mark sent.
3. **Branch-state delay.** If `kind IN ('lost','returned','disputed')` and
   the row was enqueued less than 15 minutes ago, skip this tick (leaves
   `status='sending'` → flip back to `pending` for next tick) so an
   officer can intercept manually. (Implementation note: easier to add a
   `delay_until` check on the *first* sweep — if branch-state, set
   `scheduled_for = created_at + interval '15 minutes'` before flipping
   to `sending` next time.)
4. **Opt-out.** If `students.parcel_notifications_opted_out = true`, skip
   with reason `opted_out`.
5. **48h freshness.** WeChat 客服消息 only works for users active in the
   past 48h. Check `students.last_wechat_interaction_at`. If older, skip
   with reason `wechat_stale_48h`. (These will be covered by template
   messages in Phase 1b / handoff #6.)

## Copy templates (bilingual)

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

1. **Add the opt-out column** by applying a follow-up migration (call it
   `20260606_students_parcel_opt_out.sql`). Until then, george should
   treat the opt-out filter as a no-op (always-`false` fallback).
2. **Pull `BIBOYANG425/george` `main`** and confirm the parcel
   notification cron is implemented. Spec is this file.
3. **Set env vars on george** (none new required if it already has
   `SUPABASE_SERVICE_ROLE_KEY` and the WeChat OA credentials).
4. **Redeploy george** the usual way (Docker image rebuild + restart).
5. **Verify** (see below).

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
