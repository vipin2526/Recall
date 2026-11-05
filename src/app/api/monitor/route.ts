import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readUser } from '@/lib/auth';
import { getDb } from '@/lib/db/connection';
import type { MonitorSummary } from '@/lib/db/types';
import { noSession } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AiCallRow {
  id: string;
  kind: string;
  provider: string;
  model: string;
  latency_ms: number;
  cost_usd: number;
  validation_ok: number;
  cached: number;
  error: string | null;
  created_at: number;
}

interface FeedbackRow {
  rating: number;
  n: number;
}

interface KindAccumulator {
  calls: number;
  real: number;
  fails: number;
  latencies: number[];
  costUsd: number;
}

function percentile(sortedAsc: number[], rank: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.ceil(rank * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, index))];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function GET(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const rawHours = Number(new URL(req.url).searchParams.get('hours') ?? '24');
  const hours = Number.isFinite(rawHours) ? Math.min(168, Math.max(1, Math.round(rawHours))) : 24;
  const since = Date.now() - hours * 3_600_000;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, kind, provider, model, latency_ms, cost_usd, validation_ok, cached, error, created_at
       FROM ai_calls WHERE created_at >= ? ORDER BY created_at DESC`,
    )
    .all(since) as AiCallRow[];

  const feedbackRows = db
    .prepare('SELECT rating, COUNT(*) AS n FROM ai_feedback WHERE created_at >= ? GROUP BY rating')
    .all(since) as FeedbackRow[];

  const totalCalls = rows.length;
  const cachedCount = rows.filter((row) => row.cached === 1).length;
  const realCalls = rows.filter((row) => row.cached === 0);

  const validationFailRate =
    realCalls.length > 0
      ? realCalls.filter((row) => row.validation_ok === 0).length / realCalls.length
      : 0;

  const latencies = realCalls
    .map((row) => row.latency_ms)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const avgLatencyMs =
    latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0;
  const p95LatencyMs = percentile(latencies, 0.95);

  const costUsd = rows.reduce((sum, row) => sum + (Number.isFinite(row.cost_usd) ? row.cost_usd : 0), 0);
  const cacheHitRate = totalCalls > 0 ? cachedCount / totalCalls : 0;

  const kindMap = new Map<string, KindAccumulator>();
  for (const row of rows) {
    const entry = kindMap.get(row.kind) ?? {
      calls: 0,
      real: 0,
      fails: 0,
      latencies: [],
      costUsd: 0,
    };
    entry.calls += 1;
    entry.costUsd += Number.isFinite(row.cost_usd) ? row.cost_usd : 0;
    if (row.cached === 0) {
      entry.real += 1;
      if (row.validation_ok === 0) entry.fails += 1;
      if (Number.isFinite(row.latency_ms) && row.latency_ms > 0) entry.latencies.push(row.latency_ms);
    }
    kindMap.set(row.kind, entry);
  }

  const byKind = [...kindMap.entries()].map(([kind, entry]) => ({
    kind,
    calls: entry.calls,
    validationFailRate: entry.real > 0 ? round(entry.fails / entry.real, 4) : 0,
    p95LatencyMs: percentile(entry.latencies.sort((a, b) => a - b), 0.95),
    costUsd: round(entry.costUsd, 6),
  }));

  const alerts: MonitorSummary['alerts'] = [];
  if (realCalls.length >= 20 && validationFailRate > 0.02) {
    alerts.push({
      level: 'error',
      message: `Validation failure rate is ${(validationFailRate * 100).toFixed(1)}% across ${realCalls.length} calls (target at most 2%).`,
    });
  }
  if (p95LatencyMs > 6000) {
    alerts.push({
      level: 'warn',
      message: `p95 latency is ${Math.round(p95LatencyMs)} ms (target at most 6000 ms).`,
    });
  }
  const scaledCostBudget = 5 * (hours / 24);
  if (costUsd > scaledCostBudget) {
    alerts.push({
      level: 'warn',
      message: `Estimated AI cost is $${costUsd.toFixed(2)} over ${hours}h, above the $${scaledCostBudget.toFixed(2)} threshold.`,
    });
  }

  const summary: MonitorSummary = {
    windowHours: hours,
    totalCalls,
    validationFailRate: round(validationFailRate, 4),
    p95LatencyMs,
    avgLatencyMs: Math.round(avgLatencyMs),
    costUsd: round(costUsd, 6),
    cacheHitRate: round(cacheHitRate, 4),
    byKind,
    recent: rows.slice(0, 20).map((row) => ({
      id: row.id,
      kind: row.kind,
      provider: row.provider,
      model: row.model,
      latencyMs: row.latency_ms,
      validationOk: row.validation_ok === 1,
      cached: row.cached === 1,
      costUsd: row.cost_usd,
      createdAt: row.created_at,
      error: row.error,
    })),
    alerts,
    feedback: {
      up: feedbackRows.find((row) => row.rating === 1)?.n ?? 0,
      down: feedbackRows.find((row) => row.rating === -1)?.n ?? 0,
    },
  };

  return NextResponse.json(summary);
}
