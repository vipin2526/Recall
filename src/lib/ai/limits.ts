import { getDb } from '../db/connection';
import { DAY_MS } from '../scheduler';
import { LIMITS } from '../schemas';

export class RateLimitError extends Error {
  retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("You've reached today's AI limit.");
    this.name = 'RateLimitError';
    this.retryAfterMs = Math.max(1000, Math.round(retryAfterMs));
  }
}

function startOfUtcDayMs(ts: number): number {
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function assertAiBudget(userId: string): void {
  const db = getDb();
  const row = db
    .prepare('SELECT daily_ai_limit FROM users WHERE id = ?')
    .get(userId) as { daily_ai_limit: number } | undefined;

  const limit =
    row && Number.isFinite(row.daily_ai_limit) && row.daily_ai_limit > 0
      ? row.daily_ai_limit
      : LIMITS.dailyFreeAiCalls;

  const now = Date.now();
  const dayStart = startOfUtcDayMs(now);
  const counted = db
    .prepare(
      'SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ? AND cached = 0 AND created_at >= ?',
    )
    .get(userId, dayStart) as { n: number };

  if (counted.n >= limit) {
    throw new RateLimitError(dayStart + DAY_MS - now);
  }
}
