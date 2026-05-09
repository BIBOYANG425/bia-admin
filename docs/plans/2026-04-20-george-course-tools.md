# George Course Tools & RMP Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire George's `course` sub-agent to the newly-ingested `courses` / `programs` tables and to live RMP ratings, so a question like "writ150 哪个 prof 最好" returns section-level recommendations filtered by RMP score — not hardcoded lore.

**Architecture:**
- Three new tools proxy the structured catalog + RMP data: `describe_course` (exact lookup by dept+code from `courses`), `search_programs` (FTS/embedding over `programs`), `get_rmp_ratings` (wraps bia-roommate's `/api/rmp/batch`).
- Two existing tools get enriched: `get_course_reviews` merges RMP aggregates with BIA internal reviews; `search_courses` joins live WebReg sections with catalog description/prereqs from `courses`.
- One bug fix: `recommend_courses` times out because bia-roommate runs an LLM agent by default. Pass `mode: 'free'` to skip it.
- Prompt update: the `course` sub-agent's system prompt codifies the flow `search_courses → get_rmp_ratings → filter by rule` so George stops bluffing rmp scores.

**Tech Stack:** TypeScript · vitest · `@anthropic-ai/sdk` · `@supabase/supabase-js` · existing george tool registry

**Preconditions:**
- Catalogue scrape (`docs/plans/2026-04-20-courses-programs-ingest.md`) has populated `courses` (≈13k rows) and `programs` (≈1.1k rows) in Supabase.
- `bia-roommate` Next.js app is running on `localhost:3000` (exposes `/api/rmp/*` + `/api/course-rating/*`).
- `george/.env` has `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `KIMI_API_KEY`, `KIMI_BASE_URL=https://api.moonshot.ai/v1`, `SUPABASE_*`, `BIA_ROOMMATE_API_URL=http://localhost:3000`, `ADMIN_TOKEN`.

---

## Task 1: `describe_course` tool — exact catalog lookup

**Files:**
- Create: `george/src/tools/describe-course.ts`
- Test: `george/tests/tools/describe-course.test.ts`

**Step 1: Write the failing test**

```typescript
// george/tests/tools/describe-course.test.ts
import { describe, it, expect, beforeAll } from 'vitest'

describe('describe_course tool', () => {
  beforeAll(async () => {
    await import('../../src/tools/describe-course.js')
  })

  it('registers with the tool registry', async () => {
    const { getToolDefinitions } = await import('../../src/agent/tool-registry.js')
    const tool = getToolDefinitions().find((t) => t.name === 'describe_course')
    expect(tool).toBeDefined()
    expect(tool?.input_schema.properties).toHaveProperty('dept')
    expect(tool?.input_schema.properties).toHaveProperty('code')
  })

  it('returns a not-found message when the course is missing', async () => {
    const { executeTool } = await import('../../src/agent/tool-registry.js')
    const result = await executeTool('describe_course', { dept: 'ZZZ', code: '999' })
    expect(result.toLowerCase()).toContain('not found')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd george && npx vitest run tests/tools/describe-course.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement the tool**

```typescript
// george/src/tools/describe-course.ts
// Looks up a single USC course in the `courses` table populated from catalogue.usc.edu.
// Exact-match only (dept + code). For fuzzy discovery, use search_courses.
//
// Header last reviewed: 2026-04-20

import { registerTool } from '../agent/tool-registry.js'
import { supabase } from '../db/client.js'

registerTool(
  'describe_course',
  'Look up the catalog description, units, prerequisites, and terms for a specific USC course. Exact match on department + code (e.g., dept="WRIT", code="150").',
  {
    properties: {
      dept: { type: 'string', description: 'Department code, e.g. "CSCI", "WRIT"' },
      code: { type: 'string', description: 'Course number, e.g. "201L", "150"' },
    },
    required: ['dept', 'code'],
  },
  async (input) => {
    const dept = String(input.dept).toUpperCase().trim()
    const code = String(input.code).toUpperCase().trim()
    const { data, error } = await supabase
      .from('courses')
      .select('dept, code, title, description, units, terms, prereq, corequisite, recommended_prep, restriction, mode, grading, source_url')
      .eq('dept', dept)
      .eq('code', code)
      .limit(1)
      .maybeSingle()

    if (error) return `Lookup failed: ${error.message}`
    if (!data) return `Course ${dept} ${code} not found in the USC catalog.`
    return JSON.stringify(data, null, 2)
  },
)
```

**Step 4: Run test to verify it passes**

```bash
cd george && npx vitest run tests/tools/describe-course.test.ts
```
Expected: PASS (both cases).

**Step 5: Commit**

```bash
git add george/src/tools/describe-course.ts george/tests/tools/describe-course.test.ts
git commit -m "feat(george): describe_course tool — exact catalog lookup by dept+code"
```

---

## Task 2: `search_programs` tool — FTS + embedding over programs

**Files:**
- Create: `george/src/tools/search-programs.ts`
- Test: `george/tests/tools/search-programs.test.ts`

**Step 1: Write the failing test**

```typescript
// george/tests/tools/search-programs.test.ts
import { describe, it, expect, beforeAll } from 'vitest'

describe('search_programs tool', () => {
  beforeAll(async () => {
    await import('../../src/tools/search-programs.js')
  })

  it('registers with the tool registry', async () => {
    const { getToolDefinitions } = await import('../../src/agent/tool-registry.js')
    const tool = getToolDefinitions().find((t) => t.name === 'search_programs')
    expect(tool).toBeDefined()
    expect(tool?.input_schema.properties).toHaveProperty('query')
  })

  it('returns an empty-string payload when nothing matches', async () => {
    const { executeTool } = await import('../../src/agent/tool-registry.js')
    const result = await executeTool('search_programs', { query: 'zzzzznonsense_xyz' })
    expect(result.toLowerCase()).toContain('no programs')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd george && npx vitest run tests/tools/search-programs.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement the tool**

```typescript
// george/src/tools/search-programs.ts
// Searches USC programs (majors/minors/certificates) ingested from catalogue.usc.edu.
// Uses the same FTS/ILIKE fallback helper as campus_knowledge so it works with or
// without pgvector. `school` is an optional filter.
//
// Header last reviewed: 2026-04-20

import { registerTool } from '../agent/tool-registry.js'
import { searchWithFallback } from './search-helpers.js'

registerTool(
  'search_programs',
  'Search USC programs (majors, minors, certificates, degrees). Returns name, school, degree_type, and description. Optional school filter.',
  {
    properties: {
      query: { type: 'string', description: 'Free-text search — program name, topic, or school fragment' },
      school: { type: 'string', description: 'Optional: restrict to one school, e.g. "Marshall", "Viterbi", "Dornsife"' },
    },
    required: ['query'],
  },
  async (input) => {
    const query = String(input.query).trim()
    const school = input.school ? String(input.school).trim() : undefined

    const data = await searchWithFallback<{
      name: string
      degree_type: string | null
      school: string | null
      description: string | null
    }>('programs', 'name, degree_type, school, description', query, {
      ftsColumn: 'description',
      ilikeColumns: ['name', 'description'],
      applyFilters: (q) => (school ? q.ilike('school', `%${school}%`) : q),
    })

    if (!data || data.length === 0) return 'No programs matched that query.'
    return JSON.stringify(data, null, 2)
  },
)
```

**Step 4: Run test to verify it passes**

```bash
cd george && npx vitest run tests/tools/search-programs.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add george/src/tools/search-programs.ts george/tests/tools/search-programs.test.ts
git commit -m "feat(george): search_programs tool over USC programs table"
```

---

## Task 3: `get_rmp_ratings` tool — proxy to bia-roommate RMP batch

**Files:**
- Create: `george/src/tools/get-rmp-ratings.ts`
- Test: `george/tests/tools/get-rmp-ratings.test.ts`

**Step 1: Write the failing test**

```typescript
// george/tests/tools/get-rmp-ratings.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest'

describe('get_rmp_ratings tool', () => {
  beforeAll(async () => {
    await import('../../src/tools/get-rmp-ratings.js')
  })

  it('registers with the tool registry', async () => {
    const { getToolDefinitions } = await import('../../src/agent/tool-registry.js')
    const tool = getToolDefinitions().find((t) => t.name === 'get_rmp_ratings')
    expect(tool).toBeDefined()
    expect(tool?.input_schema.properties).toHaveProperty('names')
  })

  it('returns a validation error for empty names', async () => {
    const { executeTool } = await import('../../src/agent/tool-registry.js')
    const result = await executeTool('get_rmp_ratings', { names: [] })
    expect(result.toLowerCase()).toContain('names')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd george && npx vitest run tests/tools/get-rmp-ratings.test.ts
```
Expected: FAIL — module not found.

**Step 3: Implement the tool**

```typescript
// george/src/tools/get-rmp-ratings.ts
// Batch-looks-up RMP (RateMyProfessors) ratings for USC instructors. Proxies to
// bia-roommate's /api/rmp/batch endpoint which handles the RMP GraphQL + in-memory
// caching. Returns {name → {avgRating, avgDifficulty, numRatings, wouldTakeAgainPercent}}.
//
// Header last reviewed: 2026-04-20

import { registerTool } from '../agent/tool-registry.js'
import { config } from '../config.js'

registerTool(
  'get_rmp_ratings',
  'Look up RateMyProfessors ratings for USC instructors in batch. Returns per-name rating (avg, difficulty, count, would-take-again%) or null for professors with no RMP record. Always call this before quoting an rmp score to the student.',
  {
    properties: {
      names: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of instructor full names (first + last). Max 50.',
      },
    },
    required: ['names'],
  },
  async (input) => {
    const names = Array.isArray(input.names) ? (input.names as string[]).filter((n) => n && n.trim()) : []
    if (names.length === 0) return 'Error: names must be a non-empty array of instructor names.'
    if (names.length > 50) return 'Error: at most 50 names per call.'

    const res = await fetch(`${config.biaRoommate.baseUrl}/api/rmp/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return `RMP batch lookup failed (${res.status})`
    const data = await res.json()
    return JSON.stringify(data, null, 2)
  },
)
```

**Step 4: Run test to verify it passes**

```bash
cd george && npx vitest run tests/tools/get-rmp-ratings.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add george/src/tools/get-rmp-ratings.ts george/tests/tools/get-rmp-ratings.test.ts
git commit -m "feat(george): get_rmp_ratings tool for live prof RMP lookups"
```

---

## Task 4: Extend `get_course_reviews` — merge BIA aggregates + RMP

**Files:**
- Modify: `george/src/tools/get-course-reviews.ts`
- Test: `george/tests/tools/get-course-reviews.test.ts`

**Step 1: Read the current implementation**

```bash
cat george/src/tools/get-course-reviews.ts
```

Note the existing API call it makes (should be to `/api/course-rating/reviews` or `/aggregates`) and preserve that. We add a parallel call to `/api/rmp/batch` once we know the instructor list.

**Step 2: Write the failing test**

```typescript
// george/tests/tools/get-course-reviews.test.ts
import { describe, it, expect, beforeAll } from 'vitest'

describe('get_course_reviews tool (extended)', () => {
  beforeAll(async () => {
    await import('../../src/tools/get-course-reviews.js')
  })

  it('response includes both bia_reviews and rmp fields in its schema doc', async () => {
    const { getToolDefinitions } = await import('../../src/agent/tool-registry.js')
    const tool = getToolDefinitions().find((t) => t.name === 'get_course_reviews')
    expect(tool?.description.toLowerCase()).toContain('rmp')
  })
})
```

**Step 3: Run test to verify it fails**

```bash
cd george && npx vitest run tests/tools/get-course-reviews.test.ts
```
Expected: FAIL — description doesn't yet mention rmp.

**Step 4: Modify the tool**

Update `george/src/tools/get-course-reviews.ts`:
- Keep existing BIA-aggregates fetch.
- After extracting instructor names from the sections, also call `/api/rmp/batch`.
- Return `{ bia_reviews: [...], rmp: { [name]: rating } }` as one JSON blob.
- Update the tool description to mention RMP.

```typescript
// Pseudocode shape — adapt to the existing file's helpers:
registerTool(
  'get_course_reviews',
  'Get ratings for a specific USC course. Returns BIA student reviews AND live RateMyProfessors ratings for every instructor who teaches that course. Use this instead of guessing rmp scores.',
  { /* existing schema */ },
  async (input) => {
    const reviewsRes = await fetch(`${config.biaRoommate.baseUrl}/api/course-rating/reviews?...`)
    const reviews = await reviewsRes.json()
    const instructorNames = [...new Set((reviews.sections ?? []).map((s) => s.instructor).filter(Boolean))]
    let rmp: Record<string, unknown> = {}
    if (instructorNames.length > 0) {
      const rmpRes = await fetch(`${config.biaRoommate.baseUrl}/api/rmp/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: instructorNames }),
        signal: AbortSignal.timeout(15_000),
      })
      if (rmpRes.ok) rmp = await rmpRes.json()
    }
    return JSON.stringify({ bia_reviews: reviews, rmp }, null, 2)
  },
)
```

**Step 5: Run test to verify it passes**

```bash
cd george && npx vitest run tests/tools/get-course-reviews.test.ts
```
Expected: PASS.

**Step 6: Commit**

```bash
git add george/src/tools/get-course-reviews.ts george/tests/tools/get-course-reviews.test.ts
git commit -m "feat(george): get_course_reviews merges BIA aggregates + live RMP"
```

---

## Task 5: Extend `search_courses` — enrich with catalog description/prereq

**Files:**
- Modify: `george/src/tools/search-courses.ts`
- Test: `george/tests/tools/search-courses.test.ts`

**Step 1: Read the current implementation**

```bash
cat george/src/tools/search-courses.ts
```

It currently proxies to `/api/courses/search` on bia-roommate (live WebReg autocomplete). We keep that and, for each hit, also pull description + prereq from the `courses` table.

**Step 2: Write the failing test**

```typescript
// george/tests/tools/search-courses.test.ts
import { describe, it, expect, beforeAll } from 'vitest'

describe('search_courses tool (enriched)', () => {
  beforeAll(async () => {
    await import('../../src/tools/search-courses.js')
  })

  it('description mentions catalog enrichment', async () => {
    const { getToolDefinitions } = await import('../../src/agent/tool-registry.js')
    const tool = getToolDefinitions().find((t) => t.name === 'search_courses')
    expect(tool?.description.toLowerCase()).toMatch(/description|catalog|prereq/)
  })
})
```

**Step 3: Run test to verify it fails**

```bash
cd george && npx vitest run tests/tools/search-courses.test.ts
```
Expected: FAIL — description doesn't mention catalog.

**Step 4: Modify the tool**

Update `george/src/tools/search-courses.ts`:
- Keep the WebReg fetch.
- After collecting the result list, batch-query the `courses` table by `(dept, code)` pairs.
- Merge each row with its catalog match on `dept + code` (trim any suffix letter if needed — catalog stores "201L", WebReg may return "201").
- Return the merged array.

```typescript
// Pseudocode shape:
const sections = await (await fetch(`${base}/api/courses/search?...`)).json()
const depts = [...new Set(sections.map((s) => s.department))]
const numbers = [...new Set(sections.map((s) => s.number))]
const { data: catalogRows } = await supabase
  .from('courses')
  .select('dept, code, description, prereq, units, terms')
  .in('dept', depts)
  .in('code', numbers)
const catalogMap = new Map(catalogRows?.map((r) => [`${r.dept}-${r.code}`, r]) ?? [])
const enriched = sections.map((s) => ({
  ...s,
  catalog: catalogMap.get(`${s.department}-${s.number}`) ?? null,
}))
```

Update the tool description to include "Returns live section list enriched with catalog description/prereq/units."

**Step 5: Run test to verify it passes**

```bash
cd george && npx vitest run tests/tools/search-courses.test.ts
```
Expected: PASS.

**Step 6: Commit**

```bash
git add george/src/tools/search-courses.ts george/tests/tools/search-courses.test.ts
git commit -m "feat(george): search_courses enriches sections with catalog description/prereq"
```

---

## Task 6: Fix `recommend_courses` timeout

**Files:**
- Modify: `george/src/tools/recommend-courses.ts`

**Step 1: Diagnose**

The tool currently calls `/api/courses/recommend` without specifying `mode`. That route falls through to "agent mode" (LLM-driven recommender) which can run 30+ seconds. George's 10s `AbortSignal.timeout(10_000)` kills it every time.

**Step 2: Modify the tool**

Change the body-building lines in `george/src/tools/recommend-courses.ts`:

```typescript
// Before:
const body: Record<string, string> = { interests: input.interests as string }
if (input.semester) body.semester = input.semester as string
if (input.units) body.units = input.units as string
if (input.level) body.level = input.level as string

// After — pass mode:'free' to skip LLM agent mode:
const body: Record<string, string> = {
  interests: input.interests as string,
  mode: 'free',
}
if (input.semester) body.semester = input.semester as string
if (input.units) body.units = input.units as string
if (input.level) body.level = input.level as string
```

Also bump the timeout to 20s as safety margin (the free path is fast but does some USC API fetching):

```typescript
signal: AbortSignal.timeout(20_000),
```

**Step 3: Manual smoke test**

```bash
# Ensure bia-roommate is running on :3000
# Ensure george dev server is running on :3001
curl -s -X POST http://localhost:3001/chat \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"rmp-test","platform":"imessage","text":"帮我推荐三门 AI 相关的课"}'
```
Expected: non-error response in under 20s. Tail the server log and confirm no `tool_error` with `timeout` for `recommend_courses`.

**Step 4: Commit**

```bash
git add george/src/tools/recommend-courses.ts
git commit -m "fix(george): recommend_courses uses mode='free' to avoid LLM-agent timeout"
```

---

## Task 7: Register new tools + update sub-agent tool lists

**Files:**
- Modify: `george/src/index.ts` (side-effect imports)
- Modify: `george/src/agent/george.ts` (`SUB_AGENT_TOOLS`)

**Step 1: Add side-effect imports to `src/index.ts`**

Find the block of `import './tools/xxx.js'` lines (around line 25–45) and add:

```typescript
import './tools/describe-course.js'
import './tools/search-programs.js'
import './tools/get-rmp-ratings.js'
```

**Step 2: Extend `SUB_AGENT_TOOLS` in `src/agent/george.ts:52`**

Current course list:
```typescript
course: ['search_courses', 'get_course_reviews', 'recommend_courses', 'plan_schedule', 'course_tips', 'lookup_student', 'load_skill'],
```

Change to:
```typescript
course: ['search_courses', 'describe_course', 'get_course_reviews', 'get_rmp_ratings', 'recommend_courses', 'plan_schedule', 'course_tips', 'search_programs', 'lookup_student', 'load_skill'],
```

Also expose `describe_course` on the general/freshman-FAQ path (decision 2 — it's on whichever sub-agent is invoked on non-routed / general messages; check `george.ts` for the general tool list and add there too. If general flow uses a separate allowlist, add it. If it inherits all tools, nothing to do — verify.).

**Step 3: Type-check**

```bash
cd george && npx tsc --noEmit
```
Expected: no errors.

**Step 4: Restart the dev server and hit `/health`**

```bash
# In the running server task output, confirm:
# "server_started" log shows tools: 21 (was 18 — +describe_course +search_programs +get_rmp_ratings)
curl -s http://localhost:3001/health
```
Expected: `tools` count increases by 3.

**Step 5: Commit**

```bash
git add george/src/index.ts george/src/agent/george.ts
git commit -m "feat(george): register describe_course/search_programs/get_rmp_ratings + expose to course sub-agent"
```

---

## Task 8: Update the `course` sub-agent prompt

**Files:**
- Modify: `george/src/agent/personality.ts` (course sub-agent domain block)

**Step 1: Locate the course domain block**

```bash
grep -n "course" george/src/agent/personality.ts | head -10
```

The `course` sub-agent system prompt lives here (the `MISCHIEF[course]` + domain expertise sections).

**Step 2: Append the RMP-gated flow**

Add this paragraph to the course domain block (wording can match the existing voice):

```
When a student asks about a specific course:
1. Call search_courses(dept, code) — this now also returns catalog description + prereq.
2. Extract the set of instructor names from the section list.
3. Call get_rmp_ratings(names) — get the live RMP for each.
4. Apply the domain rules codified in AGENT.md:
   - WRIT 150: only surface sections with rmp ≥ 5.0.
   - Other courses: rmp ≥ 3.5 for safe A.
5. Cap at 2 recommendations. Mention difficulty + would-take-again% when relevant.
6. Never quote an rmp score without calling get_rmp_ratings first. If no prof qualifies,
   say so plainly and suggest waiting a semester — don't manufacture a rating.
7. Anecdotal section warnings (BUAD 280 Sweeney etc.) from AGENT.md stay as lore but
   any NUMBER must come from the tool.
```

**Step 3: Manual validation**

```bash
# With scrape completed and bia-roommate + george running:
curl -s -X POST http://localhost:3001/chat \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"rmp-writ-test","platform":"imessage","text":"writ150 哪个 prof 我可以选"}'
```
Watch the server output for `tool_executed` events. Expected sequence: `search_courses → get_rmp_ratings → (optional get_course_reviews)`. Final reply should name at least one professor with an actual number.

**Step 4: Commit**

```bash
git add george/src/agent/personality.ts
git commit -m "feat(george): course sub-agent prompt codifies RMP-gated recommendation flow"
```

---

## Task 9: E2E smoke test — three domain queries

**Files:** none (validation only)

**Step 1: Confirm services are up**

```bash
curl -s http://localhost:3001/health    # george
curl -s http://localhost:3000/api/courses/search?q=WRIT    # bia-roommate
```

**Step 2: Fire three test queries**

```bash
TOKEN=$(grep ^ADMIN_TOKEN= george/.env | cut -d= -f2)

# (a) Course description lookup
curl -s -X POST http://localhost:3001/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"e2e-a","platform":"imessage","text":"CSCI 201L 学什么的"}'

# (b) Program search
curl -s -X POST http://localhost:3001/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"e2e-b","platform":"imessage","text":"Dornsife 有啥经济相关的 major"}'

# (c) RMP-gated recommendation
curl -s -X POST http://localhost:3001/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"e2e-c","platform":"imessage","text":"我想选 writ150, 哪个 prof 最好"}'
```

**Step 3: Validate each response**

Expected tool sequences (tail the server output):
- (a) `describe_course` OR `search_courses` → mentions "Object-oriented paradigm" or similar from the scraped description.
- (b) `search_programs` → returns a list of Dornsife economics programs (BA/BS).
- (c) `search_courses` + `get_rmp_ratings` → surfaces at least one named professor with an actual rmp number.

**Step 4: Commit** (if any docs changed during validation; often nothing to commit here).

```bash
# no-op unless docs updated
git status
```

---

## Post-completion — REQUIRED SUB-SKILL

Use **superpowers:finishing-a-development-branch** to:
1. Verify all tests pass (`npx vitest run`)
2. Verify type-check clean (`npx tsc --noEmit`)
3. Present the merge options (bundled PR to `feature/george-tirebiter` vs sub-PRs)
4. Execute the chosen option.

---

*Scrape of `courses` + `programs` tables must complete before Task 9 smoke tests can be validated
end-to-end, but Tasks 1–8 can be implemented in parallel with the running scrape since they only
touch tool code + prompt text.*
