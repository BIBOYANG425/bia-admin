# BIA Course Helper — Extension evolution plan

**Goal:** Keep the Chrome extension aligned with BIA’s course tools, Web Store policy, and user value on `webreg.usc.edu` / `classes.usc.edu`.

**Source repo:** `bia-roommate/extension` (build output: `extension/dist/` for store upload).

---

## Current product (as implemented)

| Surface | What it does |
|--------|----------------|
| Content scripts | RMP injection, schedule reader → session storage, conflict highlighter, seat counts |
| Popup | Tabs: Schedule optimizer, Interest-based discovery, Settings (toggles + semester) |
| Background | `storage`, message passing, LRU caches, calls `bia-roommate.vercel.app` APIs (RMP batch, course detail, GE, recommendations) |

**Permissions (policy-compliant):** `storage` only; `host_permissions` for WebReg, Classes, and BIA API. Unused `activeTab` removed in **v1.0.1**.

---

## CEO / scope (compressed)

**Premises (confirm with PM):**

1. Primary user is a USC student actively registering or browsing classes (not a general “study” tool).
2. Trust and privacy: minimize permissions; all heavy logic can stay on BIA API.
3. Extension should not break if WebReg DOM shifts (content scripts need defensive selectors).

**NOT in scope (defer unless product explicitly wants):**

- Account sync across devices (needs auth + new backend contracts).
- Broad `<all_urls>` or `tabs` permission “for later.”

**Possible expansions (pick 1–2 per release):**

- **A)** “What’s new” / version strip in Settings + link to BIA changelog (low risk, helps Web Store reviewers see intentional updates).
- **B)** Export course bin as shareable text or ICS snippet (medium; clarify if registrar rules allow).
- **C)** Deeper integration with `bia-roommate` features that exist in the web app but not in the popup (parity pass: list API routes vs popup flows).

---

## Design (compressed)

- Popup is already tabbed; keep loading/error states explicit for API failures (RMP batch, recommend).
- Settings: semester format (`20263`) should stay human-guarded (label + validation) to reduce bad API calls.
- Content script UI (injected badges): respect contrast and don’t cover primary WebReg CTAs.

---

## Engineering (compressed)

**Architecture:** MV3 service worker + IIFE content script + Vite popup; messages typed in `src/shared/types.ts`. No change required for “narrow permissions” model.

**Edge cases to preserve when adding features:**

- WebReg DOM changes → feature-flag or try/catch around selectors.
- API timeout / 5xx → existing fallbacks for RMP batch; mirror for new endpoints.
- Storage quota: worker already warns at high usage; new caches should use same `StorageCache` pattern.

**Tests / QA before ship:**

- `npm run build` in `extension/`; load unpacked `dist/`; smoke WebReg + popup.
- Chrome Web Store: zip **contents** of `dist/` (not the folder itself), version bump in `manifest.json`.

**Test plan artifact (reference):** exercise RMP toggle, conflict highlight, seat counts, optimizer flow, interest search, settings save.

---

## DX (compressed)

- **TTHW for contributors:** clone `bia-roommate`, `cd extension`, `npm i`, `npm run build`, Load unpacked `dist/`.
- Document in `bia-roommate/extension/README.md` (add if missing): build, zip layout, permission rationale.

---

## Decision audit trail (autoplan-style)

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|------------|-----------|
| 1 | CEO | Keep permissions minimal; no `activeTab` unless code uses `tabs`/`scripting` | Mechanical | Completeness | Store rejection already identified unused permission |
| 2 | Eng | New features should reuse background fetch + cache patterns | Mechanical | DRY | Matches existing `api-client` + `StorageCache` |

---

## GSTACK REVIEW REPORT (compressed)

| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| CEO | Scope | 1 | Complete | Defer auth/sync; prioritize parity + policy-safe polish |
| Design | Popup + injectors | 1 | Complete | Keep explicit API error states; don’t obscure WebReg |
| Eng | MV3 + API | 1 | Complete | Defensive DOM; typed messages; build/zip checklist |
| DX | Contributors | 1 | Complete | README + one-command build |

**VERDICT:** Ready to **list concrete “new features”** and turn them into tasks; full dual-voice `/autoplan` should be re-run in Claude Code with Codex + subagent if you want the full consensus tables.

---

## Next steps (action)

1. **You:** List the “new features” you want in priority order (or pick from A/B/C above).
2. **Engineering:** Implement in `bia-roommate/extension`, bump semver, `npm run build`, re-upload to Web Store.
3. **Optional:** Run full `/autoplan` in Claude Code against this file after you add a **## Requested features** section with bullets.

---

## `/autoplan` restore point

_Not captured in this session._ To capture next time:

```bash
eval "$(~/.claude/skills/gstack/bin/gstack-slug 2>/dev/null)" && mkdir -p ~/.gstack/projects/$SLUG
# copy this file to ~/.gstack/projects/$SLUG/<branch>-autoplan-restore-<timestamp>.md
```
