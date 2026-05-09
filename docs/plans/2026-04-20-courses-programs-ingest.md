# USC Courses & Programs Catalog Ingest — Plan (v1)

**Author:** Bobby + Claude (CTO mode)
**Status:** Draft — awaiting approval
**Scope:** Scrape USC catalogue, land in dedicated structured tables, not `campus_knowledge`.

## Motivation

The first-pass ingest (2026-04-20) loaded 13,917 rows into `campus_knowledge` (rolled back). Two
problems surfaced:

1. **Wrong home.** Course/program data is structured (dept, code, units, prereqs). `campus_knowledge`
   is for unstructured RAG (ghost-dog lore, food recs, study spots). Mixing them makes exact-lookup
   queries ("CSCI 201L 的 prereq") miss and makes ghost-dog fuzzy retrieval noisier.
2. **Scraper unreliable at concurrency=5.** Only ~800 of 13,038 courses returned valid HTML; the
   rest came back missing the course-code needle entirely, suggesting Acalog rate-limiting or
   session throttling. The *parser* is correct when given good HTML — the *fetcher* is the issue.

## Design

### Schema (new)

```sql
-- courses: one row per catalog course
create table courses (
  id uuid primary key default gen_random_uuid(),
  coid text unique not null,                  -- Acalog course id, source of truth
  dept text not null,                          -- "CSCI"
  code text not null,                          -- "201L"
  title text not null,
  description text,
  units text,                                  -- free text ("2", "1-4", "Max: 16.0")
  terms text,                                  -- "FaSp", "FaSpSm"
  prereq text,
  corequisite text,
  recommended_prep text,
  restriction text,
  mode text,                                   -- "Lecture", "Lab, Lecture"
  grading text,                                -- "Letter", "CR/NC"
  crosslisted text,
  source_url text not null,
  embedding vector(1536),                      -- for hybrid/semantic search
  scraped_at timestamptz default now()
);

create index idx_courses_dept_code on courses(dept, code);
create index idx_courses_embedding on courses using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create unique index idx_courses_dept_code_unique on courses(dept, code);

-- programs: one row per catalog program (major/minor/certificate)
create table programs (
  id uuid primary key default gen_random_uuid(),
  poid text unique not null,                   -- Acalog program id
  name text not null,                          -- "Accounting (BS)"
  degree_type text,                            -- "BS", "BA", "MS", "Minor", "Certificate"
  school text,                                 -- derived from Acalog school grouping
  description text,
  required_courses text[],                     -- list of course codes referenced
  source_url text not null,
  embedding vector(1536),
  scraped_at timestamptz default now()
);

create index idx_programs_name on programs(name);
create index idx_programs_school on programs(school);
create index idx_programs_embedding on programs using ivfflat (embedding vector_cosine_ops) with (lists = 50);
```

### Ingest pipeline

Reuse the existing `george/scripts/ingest-catalogue.ts` with fixes:

1. **Reliability:**
   - Concurrency 2 (down from 5)
   - Throttle 500ms (up from 250ms)
   - Validate each fetched page: the course code needle MUST appear twice. If not, mark as
     "needs retry" and retry up to 3 times with exponential backoff.
   - Log any course that still fails after retries so we can inspect manually.

2. **Parser:** already correct. Keep the `<br>`/`<hr>`/`</h1>`/`</p>` → `\n` split + per-line label detection.

3. **Destination:** insert into `courses` / `programs` tables (not `campus_knowledge`). Upsert by
   unique key (`coid` / `poid`) so re-runs are idempotent.

4. **Embedding:** `${dept} ${code} — ${title}\n${description}\n${prereq_line}` → OpenAI
   `text-embedding-3-small`. Skip embedding if description is truly empty (title-only courses
   have no meaningful content to embed; retrieval will still work via the `dept`/`code` columns).

### Tool integration

Update `george/src/tools/search-courses.ts`:

- Keep live WebReg call for section-level availability (units, sections, instructor, times).
- ALSO query `courses` table for description, prereq, units when looking up by `dept+code` or by
  free-text search. Merge the two into the tool response.

Update `search_courses` tool schema to surface the new fields so sub-agents can pass them through.

Add a new tool `describe_course(dept, code)` that does *only* the catalog lookup — useful when the
student asks what a course covers without needing sections.

Add a new tool `search_programs(query)` that searches the `programs` table (exact + embedding).

### RMP integration (the missing link)

**The gap:** George's prompt hardcodes RMP rules (`writ150 rmp 5.0 only`, `≥3.5 for safe A`,
`Sweeney BUAD 280 考试一个半小时 200 道题`) but he has **no tool to actually look up RMP data**. He
improvises from static lore instead of citing the live number. Students lose trust the moment a
quoted rating is wrong.

**bia-roommate already has the surface:**
- `GET /api/rmp/search?name=<prof>` → `{avgRating, avgDifficulty, numRatings, wouldTakeAgainPercent}`
- `POST /api/rmp/batch` with `{names: [...]}` → map of name → rating (cached, up to 50 names)
- `GET /api/course-rating/aggregates?courses=CSCI-201,MATH-225` → BIA internal reviews

**Design: rmp is prof-level, not course-level.** *Never* store `rmp_score` on the `courses` table —
AGENT.md's first course rule says "Section > course: same course under different profs varies
wildly. Look at prof rating before class rating." So RMP is queried *at recommendation time*,
scoped to the specific sections WebReg returns.

**New tools in george:**

1. `get_rmp_ratings(names: string[])` — wraps `/api/rmp/batch`. Returns per-name rating or null.
2. Extend `search_courses` response to include *section-level* instructor names when available (it
   already does via WebReg — just surface the field cleanly to the sub-agent).
3. Extend `get_course_reviews` to also return RMP aggregates, not just BIA internal reviews. Same
   tool, richer payload.

**Prompt update for the `course` sub-agent:** codify the flow so George actually calls these tools:

```
When asked about a specific course (e.g. "writ150 哪个 prof 最好"):
1. Call search_courses(dept, code) to get the section list with instructor names.
2. Call get_rmp_ratings(names) to pull RMP for each distinct instructor.
3. Apply the domain rules:
   - WRIT 150: only surface sections with rmp ≥ 5.0.
   - Other courses: rmp ≥ 3.5 for safe A.
   - Mention difficulty and wouldTakeAgain% when relevant.
4. Cap at 2 recommendations. If nothing qualifies, say so plainly —
   don't fake-recommend a rating.
5. Never quote an rmp score without calling the tool first.
```

The BUAD 280 Sweeney / section-specific warnings stay as *lore* in the prompt (they're historical
group knowledge, not RMP). George can reference them opinionatively, but any numeric rating MUST
come from the tool.

**Non-goal:** don't scrape and cache all USC profs' RMP scores proactively. RMP changes
per-semester, `rmp/batch` has in-memory caching already, and students usually ask about the same
small set of popular profs — live-lookup with caching is the right layer.

### Safety / hygiene

- Catalogue ingest is a one-shot — runs only when explicitly invoked. No cron.
- `scraped_at` column on each row lets us see staleness. Re-run once per academic year.
- Robots.txt check: `catalogue.usc.edu` allows `User-agent: *` for course/program pages (only
  disallows `/portfolio.php` etc.). Still use a polite identifying User-Agent.

## Tasks

1. **Schema migration** — add `courses` + `programs` tables to Supabase. Generate typed
   client if the project uses typed Supabase (check).
2. **Refactor `ingest-catalogue.ts`:**
   a. Swap destination from `campus_knowledge` to `courses` / `programs`.
   b. Add retry logic + page validation.
   c. Drop concurrency to 2, throttle to 500ms.
   d. Keep disk checkpointing.
3. **Run ingest** — full scrape with the new pipeline. Monitor for validation failures.
4. **Update `search_courses` tool** to read from `courses` table when looking up
   descriptions / prereqs.
5. **Add `describe_course` + `search_programs` tools** to george's tool registry. Register in
   `src/index.ts`.
6. **Add `get_rmp_ratings` tool** wrapping bia-roommate's `/api/rmp/batch`. Update `get_course_reviews`
   to also include RMP aggregates. Update the `course` sub-agent prompt to require a tool call
   before quoting any rmp number.
7. **Smoke-test George** end-to-end: fire course-domain queries via `/chat` and confirm the sub-agent
   calls `search_courses` → `get_rmp_ratings` → surfaces named sections with real live ratings.
8. **Cleanup:** delete `data/ingest/catalogue/details.json` (stale bad data from first run) so the
   new pipeline builds a fresh cache.

## Non-goals

- Rewriting `bia-roommate/app/api/courses/recommend/route.ts` (its timeout is a separate bug; file
  separately as `recommend_courses_timeout`).
- Ingesting Schools / Academic Units description pages (navoid=8862 / navoid=8930). Can be a v2
  if catalog descriptions aren't enough.
- Hourly / weekly refresh. One-shot by human trigger is fine for a yearly-updating catalog.

## Cost / time estimate

- Scrape: 13k courses + 1.1k programs at 500ms throttle, concurrency 2 → ~60 min.
- Embed: ~13k rows (minus title-only skips) via OpenAI batched 100 at a time → ~3 min, ~$0.15.
- Dev time: ~2 hours (migration + refactor + tool updates + test).

## Decisions (approved 2026-04-20)

1. **`recommend_courses` timeout:** fix in same PR.
2. **`describe_course` tool visibility:** exposed to `course` sub-agent + general/freshman-FAQ flow
   (so a new student asking "什么是 writ150" during onboarding gets a catalog-backed answer
   without waiting on the course sub-agent handoff).
3. **`programs.school`:** derive now. Authoritative source is `navoid=8930` ("Programs by School")
   — programs appear under school headings on that page. Scrape the school grouping from that
   index instead of guessing from program name suffix.
4. **Programs + schools also in `campus_knowledge`:** so campus sub-agent RAG queries ("Dornsife
   有啥专业", "Marshall 简介") hit them. Dual-write:
   - `programs` → structured table (exact lookup / filter by school/degree)
     AND mirrored into `campus_knowledge` with `category='usc_program'`.
   - School-level descriptions (from navoid=8862 "Schools and Academic Units") → only
     `campus_knowledge` with `category='usc_school'`. No separate `schools` table (only
     ~20 rows, and we only ever want free-text retrieval).
   - **Courses stay structured-only** — 13k rows would dilute RAG and most are formulaic
     seminar / dissertation units with no free-text value.

---

*Status: APPROVED. Executing in batches of 3 tasks with checkpoints.*
