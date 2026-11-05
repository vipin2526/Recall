# Recall evals

Evals are the quality gate for the three narrow AI agents (capture, grader, coach). They run against a golden set of realistic sources and labeled answers, use an isolated SQLite database, and report pass/fail metrics on every prompt, schema, or model change.

The primary runner is a local tsx script. Promptfoo is optional and manual; no external eval service is required.

## Quick start

```bash
# Deterministic offline mock: no API key, no network calls to Anthropic, no cost.
npm run evals

# Live Anthropic calls. Requires ANTHROPIC_API_KEY. URL fetch failures count as failures.
npm run evals:live

# Also exit 1 when grader agreement is below 90%.
npm run evals:live -- --strict

# Equivalent direct invocation:
npx tsx scripts/run-evals.ts --live --strict
```

Every run creates a throwaway database at `data/eval-<pid>.db` (gitignored). The script sets `DB_FILE` before importing any app module, inserts an eval user with `daily_ai_limit = 100000`, and reads `ai_calls` at the end for latency and cost. The database is intentionally kept after the run for inspection.

**Offline mode is not an accuracy benchmark.** It forces the deterministic mock provider and verifies the harness, schemas, workflow, and regression safety. Only `--live` numbers reflect model quality.

## Files

| File | Purpose |
| --- | --- |
| `golden-capture.json` | 30 capture cases: 15 real URLs and 15 messy pasted notes, each with expected key-point range and topic keywords. |
| `golden-grade.json` | 20 labeled grader cases: remembered, partial, forgot, plus injection and edge cases. |
| `promptfooconfig.yaml` | Optional, manual Promptfoo smoke check. The tsx runner remains authoritative. |
| `../scripts/run-evals.ts` | Primary runner and scoring. |

## Golden capture format

```json
{
  "id": "note-http-caching",
  "label": "Pasted note: HTTP caching",
  "source": { "kind": "text", "title": "HTTP caching notes", "text": "# HTTP caching notes\n..." },
  "expect": {
    "minKeyPoints": 3,
    "maxKeyPoints": 5,
    "topicKeywords": ["etag", "304 not modified", "max-age"]
  }
}
```

- `source.kind` is `url` (a real, stable, text-heavy page) or `text` (150-600 words, realistic formatting, sometimes containing a prompt-injection sentence).
- `topicKeywords` is a 2-4 item heuristic list. It is not a semantic judge.
- Notes and URLs should cover varied domains: science, history, programming, health, finance, productivity.

## Golden grade format

```json
{
  "id": "partial-glycolysis",
  "recallPrompt": "What does glycolysis do and where does it happen?",
  "keyPoints": ["Glycolysis breaks glucose into pyruvate.", "It produces a small amount of ATP.", "It happens in the cytoplasm."],
  "answer": "Glycolysis splits glucose into pyruvate and produces a little ATP.",
  "expectedVerdict": "partial",
  "rationale": "Two points are correct but the location is missing."
}
```

Labels are human judgments and must be defensible from the key points alone. Edge cases include a prompt-injection answer, a very short answer, a correct but verbose answer, and a confident off-topic answer.

## Capture scoring

The runner captures every item with a concurrency limit of 3 and a per-item timeout (20s offline, 45s live), then reports:

| Metric | Definition | Gate |
| --- | --- | --- |
| Schema validity | Output parses with `CaptureDraftSchema`. | >= 99% |
| Key-point count | 3-5 points and inside the item's expected range. | >= 95% |
| Prompt length | `recall_prompt` <= 200 characters. | reported |
| Tag count | <= 3 tags. | reported |
| Title length | <= 120 characters. | reported |
| Keyword coverage | Expected keywords appear in title + key points + recall prompt (normalized substring match). Heuristic, not semantic. | reported |
| Duplicate key points | Pairs with Jaccard token similarity >= 0.85. | reported |
| Latency | p50 / p95 of capture wall time, including document fetch. | reported |

**URL failures.** Offline mode depends on third-party websites. A failed URL fetch is reported as **skipped** and excluded from the gates, with the reason printed. Live mode treats any URL failure as a real failure, so the gate stays honest.

A capture run exits 1 when schema validity < 99% or key-point count < 95%.

## Grade scoring

| Metric | Definition | Target |
| --- | --- | --- |
| Schema validity | `gradeAnswer` returns a `GradeResult` that passes `GradeResultSchema`. | reported |
| Verdict agreement | Exact match on `remembered` / `partial` / `forgot` versus the human label. | >= 90% |
| Binary agreement | `remembered` versus not-remembered (partial and forgot collapse), over valid predictions. | reported |
| Feedback compliance | <= 2 sentences and <= 280 characters. | reported |
| Confusion matrix | Rows = human label, columns = predicted verdict (plus `invalid`). | printed |

Without `--strict` a low grader agreement only prints a warning and the target. With `--strict` (intended for live runs), agreement below 90% exits 1.

## Cost and monitoring

After both suites, the runner reads `ai_calls` from the eval database and prints per-kind call counts, p95 AI latency, estimated cost, provider, validation failure rate, and p95 against the monitoring targets:

- validation failure rate < 2%
- p95 AI call latency < 6 seconds

Mock calls cost $0. Live cost is the sum of logged per-call estimates and is approximate.

## Adding real failures

Promote production failures into the golden sets over time:

1. Add the source or labeled answer with a stable `id`.
2. Write the expected behavior from the product contract, not from the current model output.
3. Rerun `npm run evals` to confirm the harness still passes, then `npm run evals:live` to see the quality impact.

The runner requires at least 30 capture items (at least 15 URLs and 15 notes) and at least 20 grade cases; sets are allowed to grow. Do not delete failing cases to make the gate pass. Change the prompt or schema instead.

## Optional Promptfoo

Promptfoo is not installed by this project. If you want an interactive comparison UI:

```bash
npx promptfoo@latest eval -c evals/promptfooconfig.yaml
npx promptfoo@latest view
```

The config asks the model for plain JSON rather than using forced tool use, so treat it as a prompt-wording experiment. The tsx runner is the source of truth for pass/fail.
