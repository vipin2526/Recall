import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateCoachReport } from '@/lib/ai/coach';
import { getDb } from '@/lib/db/connection';
import { startOfUtcWeek, toDateKey } from '@/lib/db/stats';
import { jsonError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    return req.headers.get('authorization') === `Bearer ${secret}`;
  }
  return process.env.NODE_ENV !== 'production';
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) {
    return jsonError(401, 'unauthorized', 'Invalid cron credentials.');
  }

  const now = Date.now();
  const lastWeekNow = startOfUtcWeek(now) - 1;
  const weekKey = toDateKey(startOfUtcWeek(lastWeekNow));

  const db = getDb();
  const users = db.prepare('SELECT id FROM users').all() as Array<{ id: string }>;
  const existing = db.prepare('SELECT 1 AS found FROM coach_reports WHERE user_id = ? AND week_start = ?');

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    if (existing.get(user.id, weekKey)) {
      skipped += 1;
      continue;
    }
    try {
      await generateCoachReport(user.id, lastWeekNow);
      generated += 1;
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ users: users.length, generated, skipped, failed });
}

// Vercel Cron invokes this path with GET; POST stays available for manual runs.
export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
