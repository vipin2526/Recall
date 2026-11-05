/**
 * Recall eval runner.
 *
 *   npm run evals            # deterministic offline mock (no key, no cost)
 *   npm run evals -- --live  # live Anthropic calls (requires ANTHROPIC_API_KEY)
 *   npm run evals -- --live --strict
 *
 * The runner owns a throwaway SQLite database under data/ (gitignored), sets
 * DB_FILE and the provider env BEFORE importing any app module, then scores the
 * golden capture and grade sets. See evals/README.md for the metric definitions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const ROOT = process.cwd();
const EVAL_USER_ID = 'usr_eval_runner';
const CONCURRENCY = 3;
const SCHEMA_TARGET = 0.99;
const KEY_POINT_TARGET = 0.95;
const GRADE_TARGET = 0.9;

/* ------------------------------------------------------------------ CLI ---- */

interface Options {
  live: boolean;
  strict: boolean;
  help: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { live: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === '--live') options.live = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument "${arg}". Use --live, --strict or --help.`);
  }
  return options;
}

function printHelp(): void {
  console.log(
    [
      'Recall evals',
      '',
      'Usage:',
      '  npm run evals                     Offline deterministic mock (default).',
      '  npm run evals -- --live           Live Anthropic calls; needs ANTHROPIC_API_KEY.',
      '  npm run evals -- --live --strict  Also exit 1 when grader agreement < 90%.',
      '',
      'Offline mode forces the mock provider, so it measures the harness and the',
      'schemas, not model quality. Live URL fetch failures count as failures.',
    ].join('\n'),
  );
}

/* ---------------------------------------------------------------- output ---- */

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: string, value: string): string {
  return COLOR ? `\u001b[${code}m${value}\u001b[0m` : value;
}

const green = (value: string): string => paint('32', value);
const red = (value: string): string => paint('31', value);
const yellow = (value: string): string => paint('33', value);
const dim = (value: string): string => paint('2', value);
const bold = (value: string): string => paint('1', value);

function status(value: boolean): string {
  return value ? green('PASS') : red('FAIL');
}

function truncate(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, Math.max(0, max - 1))}\u2026`;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function metricLine(label: string, value: number, detail: string, target?: number): string {
  const shown = `${percent(value)}  ${dim(detail)}`;
  const painted = target === undefined ? shown : value >= target ? green(shown) : red(shown);
  return `  ${label.padEnd(24)}${painted}`;
}

function targetNote(target: number): string {
  return dim(`target >= ${percent(target)}`);
}

/* ------------------------------------------------------------ golden data ---- */

const RatingValue = z.enum(['remembered', 'partial', 'forgot']);
type RatingValue = z.infer<typeof RatingValue>;

const CaptureGoldenSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('url'), url: z.string().url() }),
    z.object({ kind: z.literal('text'), text: z.string().min(40), title: z.string().optional() }),
  ]),
  expect: z.object({
    minKeyPoints: z.number().int().min(3).max(5),
    maxKeyPoints: z.number().int().min(3).max(5),
    topicKeywords: z.array(z.string().min(1)).min(2).max(4),
  }),
});
type CaptureGolden = z.infer<typeof CaptureGoldenSchema>;

const GradeGoldenSchema = z.object({
  id: z.string().min(1),
  recallPrompt: z.string().min(3),
  keyPoints: z.array(z.string().min(1)).min(1).max(6),
  answer: z.string().min(1),
  expectedVerdict: RatingValue,
  rationale: z.string().min(1),
});
type GradeGolden = z.infer<typeof GradeGoldenSchema>;

function readGolden<T>(file: string, schema: z.ZodType<T>): T[] {
  const full = path.join(ROOT, 'evals', file);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${full}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(raw)) throw new Error(`${file} must contain a JSON array`);
  return raw.map((item, index) => {
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`${file} item ${index + 1} is invalid: ${issues.join('; ')}`);
    }
    return parsed.data;
  });
}

/* ----------------------------------------------------------------- utils ---- */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms (${label})`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function keywordHits(keywords: readonly string[], text: string): number {
  const haystack = ` ${canonical(text)} `;
  return keywords.filter((keyword) => haystack.includes(` ${canonical(keyword)} `)).length;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function countDuplicatePairs(points: readonly string[]): number {
  const tokenSets = points.map((point) => new Set(canonical(point).split(' ').filter(Boolean)));
  let pairs = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const left = canonical(points[i]);
      const right = canonical(points[j]);
      if (left === right || jaccard(tokenSets[i], tokenSets[j]) >= 0.85) pairs += 1;
    }
  }
  return pairs;
}

/* ------------------------------------------------------------- capture eval ---- */

type CaptureStatus = 'ok' | 'invalid' | 'failed' | 'skipped';

interface CaptureResult {
  item: CaptureGolden;
  status: CaptureStatus;
  latencyMs: number;
  reasons: string[];
  keyPointCount: number | null;
  promptOk: boolean;
  tagsOk: boolean;
  titleOk: boolean;
  keyPointsInRange: boolean;
  keywordHits: number;
  keywordTotal: number;
  duplicatePairs: number;
}

async function runCaptureEval(
  items: readonly CaptureGolden[],
  userId: string,
  timeoutMs: number,
  live: boolean,
): Promise<CaptureResult[]> {
  const { captureOnce } = await import('../src/lib/ai/capture');
  const { CaptureDraftSchema, LIMITS } = await import('../src/lib/schemas');

  return mapWithConcurrency(items, CONCURRENCY, async (item) => {
    const startedAt = Date.now();
    const base: CaptureResult = {
      item,
      status: 'failed',
      latencyMs: 0,
      reasons: [],
      keyPointCount: null,
      promptOk: false,
      tagsOk: false,
      titleOk: false,
      keyPointsInRange: false,
      keywordHits: 0,
      keywordTotal: item.expect.topicKeywords.length,
      duplicatePairs: 0,
    };

    try {
      const draft = await withTimeout(
        captureOnce({ userId, source: item.source }),
        timeoutMs,
        item.id,
      );
      const latencyMs = Date.now() - startedAt;
      const parsed = CaptureDraftSchema.safeParse(draft);
      if (!parsed.success) {
        return {
          ...base,
          status: 'invalid',
          latencyMs,
          reasons: parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.') || 'draft'}: ${issue.message}`),
        };
      }

      const data = parsed.data;
      const haystack = `${data.title} ${data.key_points.join(' ')} ${data.recall_prompt}`;
      const hitCount = keywordHits(item.expect.topicKeywords, haystack);

      return {
        ...base,
        status: 'ok',
        latencyMs,
        reasons: [],
        keyPointCount: data.key_points.length,
        promptOk: data.recall_prompt.length <= LIMITS.recallPromptMaxChars,
        tagsOk: data.tags.length <= LIMITS.tagsMax,
        titleOk: data.title.length <= LIMITS.titleMaxChars,
        keyPointsInRange:
          data.key_points.length >= item.expect.minKeyPoints &&
          data.key_points.length <= item.expect.maxKeyPoints,
        keywordHits: hitCount,
        keywordTotal: item.expect.topicKeywords.length,
        duplicatePairs: countDuplicatePairs(data.key_points),
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = errorMessage(err);
      // Offline URL fetching depends on third-party sites. Report those as
      // skipped so the mock harness does not fail on the network. Live mode is
      // honest: a fetch failure is a real failure.
      if (!live && item.source.kind === 'url') {
        return { ...base, status: 'skipped', latencyMs, reasons: [message] };
      }
      return { ...base, status: 'failed', latencyMs, reasons: [message] };
    }
  });
}

function reportCapture(results: readonly CaptureResult[]): {
  evaluated: number;
  validity: number;
  keyPointRate: number;
  gatePassed: boolean;
} {
  const skipped = results.filter((result) => result.status === 'skipped');
  const evaluatedResults = results.filter((result) => result.status !== 'skipped');
  const ok = evaluatedResults.filter((result) => result.status === 'ok');
  const failures = evaluatedResults.filter((result) => result.status !== 'ok');
  const evaluated = evaluatedResults.length;

  const validity = ratio(ok.length, evaluated);
  const keyPointRate = ratio(
    ok.filter((result) => result.keyPointsInRange).length,
    evaluated,
  );
  const promptRate = ratio(ok.filter((result) => result.promptOk).length, evaluated);
  const tagRate = ratio(ok.filter((result) => result.tagsOk).length, evaluated);
  const titleRate = ratio(ok.filter((result) => result.titleOk).length, evaluated);
  const keywordTotal = ok.reduce((sum, result) => sum + result.keywordTotal, 0);
  const keywordCovered = ok.reduce((sum, result) => sum + result.keywordHits, 0);
  const keywordRate = ratio(keywordCovered, keywordTotal);
  const fullKeywordItems = ok.filter(
    (result) => result.keywordTotal > 0 && result.keywordHits === result.keywordTotal,
  ).length;
  const duplicateItems = ok.filter((result) => result.duplicatePairs > 0).length;
  const latencies = evaluatedResults
    .filter((result) => result.latencyMs > 0)
    .map((result) => result.latencyMs);

  const urls = results.filter((result) => result.item.source.kind === 'url').length;

  console.log('');
  console.log(bold(`Capture — ${results.length} items (${urls} urls, ${results.length - urls} notes)`));
  console.log(
    `  ${dim(
      `${ok.length} ok, ${failures.length} failed, ${skipped.length} skipped · concurrency ${CONCURRENCY}`,
    )}`,
  );
  console.log(metricLine('schema validity', validity, `(${ok.length}/${evaluated})  ${targetNote(SCHEMA_TARGET)}`, SCHEMA_TARGET));
  console.log(metricLine('key-point count', keyPointRate, `(${ok.filter((r) => r.keyPointsInRange).length}/${evaluated})  ${targetNote(KEY_POINT_TARGET)}`, KEY_POINT_TARGET));
  console.log(metricLine('prompt length', promptRate, `(${ok.filter((r) => r.promptOk).length}/${evaluated}) <= 200 chars`));
  console.log(metricLine('tag count', tagRate, `(${ok.filter((r) => r.tagsOk).length}/${evaluated}) <= 3 tags`));
  console.log(metricLine('title length', titleRate, `(${ok.filter((r) => r.titleOk).length}/${evaluated}) <= 120 chars`));
  console.log(
    `  ${'keyword coverage'.padEnd(24)}${percent(keywordRate)}  ${dim(
      `${keywordCovered}/${keywordTotal} keyword slots · ${fullKeywordItems}/${ok.length} items fully covered (heuristic)`,
    )}`,
  );
  console.log(
    `  ${'duplicate key points'.padEnd(24)}${duplicateItems === 0 ? green('0 items') : yellow(`${duplicateItems} items`)}  ${dim('near-duplicate pairs at Jaccard >= 0.85')}`,
  );
  console.log(
    `  ${'latency'.padEnd(24)}p50 ${percentile(latencies, 50)} ms · p95 ${percentile(latencies, 95)} ms`,
  );

  if (failures.length > 0) {
    console.log('');
    console.log(red('  Failures'));
    for (const failure of failures) {
      const reason = failure.reasons[0] ?? 'unknown error';
      console.log(
        `  ${failure.item.id.padEnd(30)} ${failure.status.padEnd(8)} ${truncate(reason, 90)}`,
      );
    }
  }

  if (skipped.length > 0) {
    console.log('');
    console.log(yellow('  Skipped (offline URL fetch failures — not scored)'));
    for (const skip of skipped) {
      console.log(`  ${skip.item.id.padEnd(30)} ${truncate(skip.reasons[0] ?? 'fetch failed', 90)}`);
    }
  }

  const gatePassed =
    evaluated === 0 || (validity >= SCHEMA_TARGET && keyPointRate >= KEY_POINT_TARGET);
  if (evaluated === 0) {
    console.log(yellow('  No items were evaluated; the capture gate is inconclusive.'));
  }

  return { evaluated, validity, keyPointRate, gatePassed };
}

/* --------------------------------------------------------------- grade eval ---- */

type PredictedVerdict = RatingValue | 'invalid';

interface GradeResultRow {
  item: GradeGolden;
  predicted: PredictedVerdict;
  schemaOk: boolean;
  feedbackOk: boolean;
  latencyMs: number;
  error?: string;
}

function countSentences(text: string): number {
  return (text.match(/[.!?]+(?=\s|$)/g) ?? []).length;
}

async function runGradeEval(
  items: readonly GradeGolden[],
  userId: string,
  timeoutMs: number,
): Promise<GradeResultRow[]> {
  const { gradeAnswer } = await import('../src/lib/ai/grader');
  const { GradeResultSchema, LIMITS } = await import('../src/lib/schemas');

  return mapWithConcurrency(items, CONCURRENCY, async (item) => {
    const startedAt = Date.now();
    try {
      const outcome = await withTimeout(
        gradeAnswer({
          userId,
          recallPrompt: item.recallPrompt,
          keyPoints: item.keyPoints,
          answer: item.answer,
        }),
        timeoutMs,
        item.id,
      );
      const latencyMs = Date.now() - startedAt;

      if (!outcome.result) {
        return {
          item,
          predicted: 'invalid',
          schemaOk: false,
          feedbackOk: false,
          latencyMs,
          error: outcome.error ?? 'no result',
        };
      }

      const parsed = GradeResultSchema.safeParse(outcome.result);
      const feedbackOk =
        parsed.success &&
        parsed.data.feedback.length <= LIMITS.feedbackMaxChars &&
        countSentences(parsed.data.feedback) <= 2;

      return {
        item,
        predicted: parsed.success ? parsed.data.verdict : 'invalid',
        schemaOk: parsed.success,
        feedbackOk,
        latencyMs,
      };
    } catch (err) {
      return {
        item,
        predicted: 'invalid',
        schemaOk: false,
        feedbackOk: false,
        latencyMs: Date.now() - startedAt,
        error: errorMessage(err),
      };
    }
  });
}

interface GradeReport {
  agreement: number;
  binaryAgreement: number;
  noResultCount: number;
}

function reportGrade(results: readonly GradeResultRow[]): GradeReport {
  const total = results.length;
  const valid = results.filter((result) => result.schemaOk);
  const exactMatches = results.filter((result) => result.predicted === result.item.expectedVerdict);
  const noResult = results.filter((result) => result.predicted === 'invalid');
  const binaryCases = valid;
  const binaryMatches = binaryCases.filter((result) => {
    const expectedRemembered = result.item.expectedVerdict === 'remembered';
    const predictedRemembered = result.predicted === 'remembered';
    return expectedRemembered === predictedRemembered;
  });

  const agreement = ratio(exactMatches.length, total);
  const binaryAgreement = ratio(binaryMatches.length, binaryCases.length);
  const schemaRate = ratio(valid.length, total);
  const feedbackRate = ratio(results.filter((result) => result.feedbackOk).length, total);
  const latencies = results.map((result) => result.latencyMs);

  const labels: readonly RatingValue[] = ['remembered', 'partial', 'forgot'];
  const columns: readonly PredictedVerdict[] = ['remembered', 'partial', 'forgot', 'invalid'];
  const matrix = new Map<string, number>();
  for (const label of labels) {
    for (const column of columns) matrix.set(`${label}:${column}`, 0);
  }
  for (const result of results) {
    const key = `${result.item.expectedVerdict}:${result.predicted}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
  }

  console.log('');
  console.log(bold(`Grade — ${total} labeled cases`));
  console.log(metricLine('schema validity', schemaRate, `(${valid.length}/${total})`));
  console.log(metricLine('verdict agreement', agreement, `(${exactMatches.length}/${total})  ${targetNote(GRADE_TARGET)}`, GRADE_TARGET));
  console.log(
    `  ${'binary agreement'.padEnd(24)}${percent(binaryAgreement)}  ${dim(
      `(${binaryMatches.length}/${binaryCases.length} valid) remembered-vs-not`,
    )}`,
  );
  console.log(metricLine('feedback compliance', feedbackRate, `(${results.filter((result) => result.feedbackOk).length}/${total}) <= 2 sentences, <= 280 chars`));
  console.log(
    `  ${'latency'.padEnd(24)}p50 ${percentile(latencies, 50)} ms · p95 ${percentile(latencies, 95)} ms`,
  );

  const header = ['expected \\ predicted', ...columns];
  const widths = [22, ...columns.map(() => 13)];
  const formatRow = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join('');

  console.log('');
  console.log(dim('  Confusion matrix (rows = human label, columns = model verdict)'));
  console.log(`  ${formatRow(header)}`);
  for (const label of labels) {
    const cells = [label, ...columns.map((column) => String(matrix.get(`${label}:${column}`) ?? 0))];
    console.log(`  ${formatRow(cells)}`);
  }

  const misses = results.filter((result) => result.predicted !== result.item.expectedVerdict);
  if (misses.length > 0) {
    console.log('');
    console.log(yellow(`  Disagreements (${misses.length})`));
    for (const miss of misses) {
      const detail = miss.error ? ` · ${truncate(miss.error, 50)}` : '';
      console.log(
        `  ${miss.item.id.padEnd(30)} expected ${miss.item.expectedVerdict.padEnd(10)} got ${miss.predicted}${detail}`,
      );
    }
  }

  return { agreement, binaryAgreement, noResultCount: noResult.length };
}

/* -------------------------------------------------------------- telemetry ---- */

interface AiCallRow {
  kind: string;
  model: string;
  provider: string;
  latency_ms: number;
  cost_usd: number;
  ok: number;
  validation_ok: number;
}

function reportTelemetry(rows: readonly AiCallRow[]): number {
  console.log('');
  console.log(bold('AI calls (from the eval database)'));

  if (rows.length === 0) {
    console.log(dim('  No ai_calls rows were logged.'));
    return 0;
  }

  const byKind = new Map<string, AiCallRow[]>();
  for (const row of rows) {
    const group = byKind.get(row.kind);
    if (group) group.push(row);
    else byKind.set(row.kind, [row]);
  }

  for (const [kind, group] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cost = group.reduce((sum, row) => sum + row.cost_usd, 0);
    console.log(
      `  ${kind.padEnd(10)} ${String(group.length).padStart(3)} calls · p95 ${percentile(
        group.map((row) => row.latency_ms),
        95,
      )} ms · est. $${cost.toFixed(6)}`,
    );
  }

  const totalCost = rows.reduce((sum, row) => sum + row.cost_usd, 0);
  const validationFails = rows.filter((row) => row.validation_ok === 0).length;
  const validationFailRate = ratio(validationFails, rows.length);
  const p95 = percentile(
    rows.map((row) => row.latency_ms),
    95,
  );
  const providers = [...new Set(rows.map((row) => row.provider))].join(', ');

  console.log(
    `  ${'total'.padEnd(10)} ${String(rows.length).padStart(3)} calls · p95 ${p95} ms · est. $${totalCost.toFixed(6)} · provider ${providers}`,
  );
  console.log(
    `  ${'monitoring'.padEnd(10)} validation failure ${percent(validationFailRate)} ${dim(
      '(target < 2%)',
    )} · p95 ${p95} ms ${dim('(target < 6000 ms)')}`,
  );
  return totalCost;
}

/* ------------------------------------------------------------------ main ---- */

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  if (options.live && !hasKey) {
    console.error(
      [
        'Live evals need an Anthropic API key.',
        'Set ANTHROPIC_API_KEY in your environment (or .env) and rerun:',
        '  npm run evals:live',
        'Without a key, run the offline harness with: npm run evals',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  // Validate the golden data before touching a database.
  const captureItems = readGolden('golden-capture.json', CaptureGoldenSchema);
  const gradeItems = readGolden('golden-grade.json', GradeGoldenSchema);
  const urlCount = captureItems.filter((item) => item.source.kind === 'url').length;
  const noteCount = captureItems.length - urlCount;
  // The set starts at 30 (15 + 15) and is allowed to grow as real failures are
  // promoted into labels; it may never silently shrink.
  if (captureItems.length < 30) {
    throw new Error(`golden-capture.json needs at least 30 items (found ${captureItems.length})`);
  }
  if (urlCount < 15 || noteCount < 15) {
    throw new Error(
      `golden-capture.json needs at least 15 URLs and 15 notes (found ${urlCount} URLs, ${noteCount} notes)`,
    );
  }
  if (gradeItems.length < 20) {
    throw new Error(`golden-grade.json needs at least 20 cases (found ${gradeItems.length})`);
  }

  // The eval database must be chosen before any app module is imported.
  const evalDbFile = path.join(ROOT, 'data', `eval-${process.pid}.db`);
  fs.mkdirSync(path.dirname(evalDbFile), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${evalDbFile}${suffix}`, { force: true });
  }
  process.env.DB_FILE = evalDbFile;
  if (!options.live) delete process.env.ANTHROPIC_API_KEY;

  const { getDb } = await import('../src/lib/db/connection');
  const { getAiStatus } = await import('../src/lib/ai/status');
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, created_at, plan, daily_ai_limit, partial_counts_as, ai_grading)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(EVAL_USER_ID, Date.now(), 'eval', 100_000, 'forgot', 1);

  const aiStatus = getAiStatus();
  const mode = options.live ? 'live' : 'mock (offline)';
  const modelLabel = options.live ? aiStatus.model : 'mock-haiku (deterministic)';

  console.log(bold('Recall evals'));
  console.log(
    `  provider ${mode} · model ${modelLabel} · db ${path.relative(ROOT, evalDbFile)}`,
  );
  console.log(
    `  ${dim(
      `capture ${captureItems.length} items · grade ${gradeItems.length} cases · strict ${options.strict ? 'on' : 'off'}`,
    )}`,
  );

  const captureTimeoutMs = options.live ? 45_000 : 20_000;
  const gradeTimeoutMs = options.live ? 30_000 : 15_000;

  const captureResults = await runCaptureEval(captureItems, EVAL_USER_ID, captureTimeoutMs, options.live);
  const captureReport = reportCapture(captureResults);

  const gradeResults = await runGradeEval(gradeItems, EVAL_USER_ID, gradeTimeoutMs);
  const gradeReport = reportGrade(gradeResults);

  const rows = db
    .prepare(
      'SELECT kind, model, provider, latency_ms, cost_usd, ok, validation_ok FROM ai_calls ORDER BY created_at',
    )
    .all() as AiCallRow[];
  reportTelemetry(rows);

  const gradeGate = gradeReport.agreement >= GRADE_TARGET;
  const gradeGateActive = options.strict;
  const exitCode = captureReport.gatePassed && (gradeGateActive ? gradeGate : true) ? 0 : 1;

  console.log('');
  console.log(bold('Result'));
  console.log(
    `  capture gate   ${status(captureReport.gatePassed)}  ${dim(
      `schema ${percent(captureReport.validity)} (target 99%), key points ${percent(
        captureReport.keyPointRate,
      )} (target 95%)`,
    )}`,
  );
  console.log(
    `  grade target   ${gradeGateActive ? status(gradeGate) : dim('not gated')}  ${dim(
      `agreement ${percent(gradeReport.agreement)} vs 90% target${gradeGateActive ? ' (--strict)' : ' (use --strict to gate)'}`,
    )}`,
  );
  console.log(`  eval db        ${dim(path.relative(ROOT, evalDbFile))}`);
  console.log('');

  process.exitCode = exitCode;
}

main().catch((err: unknown) => {
  console.error(red(`Eval runner failed: ${errorMessage(err)}`));
  process.exitCode = 1;
});
