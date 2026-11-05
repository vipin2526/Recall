import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readUser } from '@/lib/auth';
import { generateCoachReport } from '@/lib/ai/coach';
import { assertAiBudget, RateLimitError } from '@/lib/ai/limits';
import { getDb } from '@/lib/db/connection';
import type { CoachReport, WeeklyStats } from '@/lib/db/types';
import { CoachSummarySchema } from '@/lib/schemas';
import { jsonError, noSession, rateLimited } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CoachReportRow {
  id: string;
  user_id: string;
  week_start: string;
  summary: string;
  stats: string;
  created_at: number;
}

function mapReport(row: CoachReportRow): CoachReport | null {
  try {
    const summary = CoachSummarySchema.safeParse(JSON.parse(row.summary));
    if (!summary.success) return null;
    const stats = JSON.parse(row.stats) as WeeklyStats;
    return {
      id: row.id,
      userId: row.user_id,
      weekStart: row.week_start,
      summary: summary.data,
      stats,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const row = getDb()
    .prepare('SELECT * FROM coach_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(user.id) as CoachReportRow | undefined;

  return NextResponse.json({ report: row ? mapReport(row) : null });
}

export async function POST(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  try {
    assertAiBudget(user.id);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimited(err.retryAfterMs);
    return jsonError(500, 'ai_unavailable', 'The coach is unavailable right now.');
  }

  try {
    const report = await generateCoachReport(user.id);
    return NextResponse.json({ report });
  } catch {
    return jsonError(500, 'coach_failed', 'Could not build your weekly summary right now.');
  }
}
