# TODOS

## George Tirebiter AI Companion

### P1 — High Priority

- [ ] **Admin Dashboard for BIA Team** — Web UI for managing events, Instagram follow list, reviewing community-submitted events, and viewing George's usage stats. Currently using Supabase Studio which works but is not accessible to non-technical BIA officers. This is the #1 operational dependency for George post-launch. Effort: L (human) → M (CC). Depends on: George V1 launch. Blocked by: nothing.

### P2 — Medium Priority

- [ ] **George's Daily Campus Report** — Opt-in morning digest with weather, top events today, and George's hot takes. Deferred from CEO plan scope expansion. Reuses proactive engine infrastructure (cron + push). Effort: M (human) → S (CC). Depends on: proactive engine.

- [ ] **WeChat Group Chat Support** — George responds to @mentions in BIA's 4 class-year WeChat groups (1,500 members). Massive reach multiplier vs 1:1 chat. Needs research into WeChat Official Account group chat API capabilities. Effort: M (human) → S (CC). Depends on: WeChat 服务号 registration, API research.

### P3 — Low Priority

- [ ] **Smart Notification Timing** — Learn per-student optimal push times based on reply patterns (when they respond fastest). Optimize proactive engine delivery timing. Requires 30+ days of usage data before meaningful. Effort: M (human) → S (CC). Depends on: proactive engine + 30 days of data.
