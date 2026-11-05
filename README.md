# Recall

Recall is a small spaced-repetition app for turning articles and notes into recall cards, grading free-recall answers, and keeping a weekly study summary. Three narrow AI agents help; **the scheduling algorithm is plain code and AI never controls it**.

| Agent | Job | Output |
| --- | --- | --- |
| Capture | Turn one URL or pasted note into one study card. | `save_notebox` |
| Grader | Compare a free-recall answer with the card's stored key points. | `grade_answer` |
| Coach | Write a three-line weekly summary from stats the app computed. | `save_coach_summary` |

Reviews follow a fixed ladder: **1, 3, 7, 21, 100, 365 days**. A remembered answer moves up one step (capped at 365 days), a forgotten answer resets to step 0 and a 1-day interval. A partial answer counts as forgotten by default, or as remembered if the user opts in. The AI can suggest a rating, but the user can always override it, and only `applyRating` in `src/lib/scheduler.ts` writes the schedule.

## Quickstart

```bash
npm install
npm run dev
# open http://localhost:3000
```

No API key is required. Without `ANTHROPIC_API_KEY`, every AI path runs on a deterministic offline mock, so the whole app (capture, grade, coach) works with zero cost and no network calls to Anthropic.

For live AI, copy the example environment file and add a key:

```bash
cp .env.example .env
# edit .env:
# ANTHROPIC_API_KEY=sk-ant-...
# AI_MODEL=claude-haiku-4-5
```

Restart the dev server after changing `.env`. The app creates its SQLite database on the first request; there is no migration step.

## Architecture

```text
src/
  app/
    page.tsx                 redirects to /today
    api/                     route handlers (see API table)
    today/ review/ capture/  client screens
    library/ insights/ monitor/
  lib/
    scheduler.ts             fixed ladder, applyRating, isDue
    schemas.ts               Zod contracts and LIMITS
    auth.ts                  anonymous cookie user
    http.ts                  JSON error helpers, idempotency header
    ids.ts                   ids, sha256, URL normalization
    db/
      connection.ts          better-sqlite3 singleton, WAL
      schema.sql             tables and indexes (applied on connect)
      queries.ts             card and user queries
      stats.ts               daily/weekly aggregates, streaks, forecast
    ai/
      capture.ts             fetch/extract -> draft workflow, SSE events
      grader.ts              forced grade_answer call and fallback
      coach.ts               weekly summary with deterministic fallback
      prompts.ts             system prompts + tool JSON schemas
      provider.ts            Anthropic provider, retries, mock provider
      document.ts            URL fetch, Readability extraction, size caps
      cache.ts               30-day URL-hash/text-hash draft cache
      limits.ts              per-user daily AI budget
      telemetry.ts           ai_calls logging, cost estimates
tests/                       vitest unit and mock integration tests
evals/                       golden sets and eval documentation
scripts/
  run-evals.ts               primary eval runner
  reset-db.ts                backup-style database reset
```

### Database

One local SQLite file (`data/recall.db` by default, override with `DB_FILE`), WAL mode, foreign keys on.

| Table | Holds |
| --- | --- |
| `users` | anonymous id, plan, daily AI limit, partial-answer policy, AI-grading switch |
| `noteboxes` | card content, tags, source URL/hash, step, due timestamp, suspension/soft delete |
| `reviews` | one row per review with idempotency key, rating, step before/after, interval, due |
| `ai_calls` | every capture/grade/coach attempt: tokens, latency, cost, validation, error |
| `ai_cache` | 30-day capture drafts keyed by normalized URL or text hash |
| `ai_feedback` | thumbs up/down per AI surface |
| `coach_reports` | weekly summary + stats snapshot, unique per user/week |
| `capture_dedup` | idempotency map for repeated capture submissions |

### Capture workflow

1. Validate the request and check the URL/text draft cache.
2. Enforce the user's daily AI budget before spending a call.
3. Fetch and extract the document (10s timeout, 3 MB cap, Readability, browser user agent) or accept pasted text. Private, loopback, link-local and `.local` hosts are rejected, and redirects are re-checked hop by hop.
4. Send a forced tool call (`save_notebox`) with the fixed system prompt; the document sits between `<document>` tags as explicitly untrusted data.
5. Validate output with Zod. On a schema miss, retry once with the validation error appended. If it still fails, return a hand-authoring fallback instead of a bad card.
6. Cache the accepted draft and stream progress to the UI as Server-Sent Events (`status`, `draft`, `error`).
7. Manual ratings still go through the same scheduler; AI is never required to save a card.

The grader and coach follow the same pattern: forced tool use, Zod validation, one corrective retry, clamped text limits, and a deterministic fallback (manual grading, or a stats-derived coach summary).

### Reliability details

- **Prompt caching:** system prompts are sent as an ephemeral `cache_control` block.
- **Forced tool use:** `tool_choice` names the one allowed tool, so there is no prose to parse.
- **SSE:** capture streams status events and ends with `[DONE]`; the client can abort.
- **URL/text cache:** identical sources reuse a draft for 30 days; cache entries are revalidated with Zod.
- **Rate limits:** default 20 AI calls per user per UTC day (`AI_DAILY_LIMIT` raises it); cached drafts do not consume budget.
- **Idempotency:** review/notebox/capture endpoints accept idempotency keys; unique constraints prevent doubles.
- **Resilience:** provider calls time out at 10s, document fetches at 10s, oversized pages/text are truncated or rejected, and every AI failure has a manual path.

## API

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/session` | `GET`, `PATCH` | Create/read the anonymous session; update partial-answer policy and AI-grading toggle. |
| `/api/capture` | `POST` | Stream a capture workflow as SSE (`status`, `draft`, `error`). |
| `/api/cards` | `GET`, `POST` | List/search cards; create a card manually (1-5 key points). |
| `/api/cards/[id]` | `GET`, `PATCH`, `DELETE` | Read, edit, suspend, or soft-delete one card. |
| `/api/grade` | `POST` | Grade a free-recall answer against stored key points. |
| `/api/reviews` | `POST` | Record a rating and advance/reset the schedule. |
| `/api/today` | `GET` | Due cards and today's queue. |
| `/api/stats` | `GET` | Accuracy, streak, step distribution, forecast, tags. |
| `/api/coach` | `GET`, `POST` | Read the latest coach report; generate one now. |
| `/api/monitor` | `GET` | Validation failures, p95 latency, cost, cache hits, alerts, feedback. |
| `/api/ai/feedback` | `POST` | Thumbs up/down for a capture, grade, or coach result. |
| `/api/cron/coach` | `GET`, `POST` | Weekly coach cron; requires `Authorization: Bearer $CRON_SECRET` in production. |

## Latency and monitoring

Product targets (not measured claims):

- AI call p95 **under 6 seconds**.
- AI validation failure rate **under 2%**.

`GET /api/monitor` aggregates `ai_calls` and powers the **/monitor** page: per-kind validation failure rate, p95 latency, cost, cache-hit rate, recent calls, alerts, and feedback counts. Cost values are estimates from logged token counts.

## Evals

The golden set lives in `evals/` and is run by a local tsx script:

```bash
npm run evals                     # offline deterministic mock, no key, no cost
npm run evals -- --live           # live Anthropic calls, requires ANTHROPIC_API_KEY
npm run evals -- --live --strict  # also exit 1 when grader agreement < 90%
```

The runner creates an isolated database at `data/eval-<pid>.db`, scores 30 capture cases (15 URLs, 15 notes) and 20 labeled grade cases, and reports:

- capture schema validity (gate: 99%+), key-point count (gate: 95%+), prompt/tag/title limits, keyword coverage, duplicate key points, latency;
- grader schema validity, three-way verdict agreement, binary remembered-vs-not agreement, feedback compliance, and a confusion matrix;
- logged AI calls, p95 latency, estimated cost, and validation failure rate.

Offline URL fetch failures are reported as skipped; live failures count against the gate. Offline mode verifies the harness, not model accuracy. See [`evals/README.md`](evals/README.md) for metric definitions, golden formats, and how to add real failures. Promptfoo is optional and manual.

## Tests

```bash
npm test                                              # vitest, whole suite
npx vitest run tests/scheduler.test.ts tests/schemas.test.ts
```

Coverage includes the full scheduler ladder and partial policy, Zod boundary cases, prompt/tool contract checks, and an end-to-end offline mock test for capture, grading, and the coach summary. The mock test uses its own temporary `DB_FILE` and a high-budget eval user.

## Coach cron

The coach summarizes the previous UTC week for every user once. With `CRON_SECRET` set, production requests must present it:

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/coach
```

In non-production, requests are allowed without a secret when `CRON_SECRET` is unset. The route accepts GET (used by Vercel Cron) and POST (manual runs), and skips users who already have a report for that week.

## Backup and reset

```bash
npm run db:reset
```

Nothing is deleted. The script moves `data/recall.db`, `-wal`, and `-shm` (or the file selected by `DB_FILE`) into `data/backups/<timestamp>/`, prints the backup path, and reminds you that the app recreates an empty database on the first request. Restore by moving the files back.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | unset | Unset means deterministic mock provider. |
| `AI_MODEL` | `claude-haiku-4-5` | Small model used for all three agents. |
| `AI_DAILY_LIMIT` | `20` | Default per-user daily AI call budget. |
| `ANTHROPIC_BASE_URL` | unset | Optional proxy/gateway base URL. |
| `CRON_SECRET` | unset | Bearer secret for `/api/cron/coach`. |
| `DB_FILE` | `data/recall.db` (`/tmp/recall.db` on Vercel) | SQLite path, relative to the project or absolute. |

## Deploy on Vercel

1. Import the GitHub repository at [vercel.com/new](https://vercel.com/new). The Next.js preset is detected automatically.
2. Optionally set `ANTHROPIC_API_KEY`, `AI_MODEL`, and `CRON_SECRET` in the project settings. Without a key the app runs in mock mode.
3. Deploy. `vercel.json` registers the weekly coach cron at Mondays 06:00 UTC; set `CRON_SECRET` so the cron call is authorized.

`DB_FILE` defaults to `/tmp/recall.db` on Vercel because the deployed project directory is read-only. **Serverless storage is ephemeral**: `/tmp` survives only within a warm instance, so cards and reviews can disappear on cold starts or redeploys, and separate instances do not share data. This is fine for a demo. For durable data, point `DB_FILE` at a persistent volume on a long-running host, or migrate the data layer to a hosted database (Postgres, Turso, etc.).

## Known limitations

- **Single local SQLite database.** No replication, no multi-instance coordination; WAL is a good fit for one process, not a cluster.
- **No accounts.** Identity is an anonymous `recall_uid` cookie; clearing cookies loses access to that user's cards.
- **Mock mode is not an accuracy benchmark.** It verifies plumbing, schemas, and regressions only.
- **URL fetching can be blocked.** Some sites reject automated requests, require JavaScript, or return paywalled/oversized pages. Localhost and private-network URLs are deliberately rejected. Pasting text is the fallback.
- **Cost estimates are approximate.** They come from logged token counts and a small local price table.
- **No measured quality claims.** The 99% schema-validity and 90% grader-agreement figures are targets enforced by evals, not achieved results.
