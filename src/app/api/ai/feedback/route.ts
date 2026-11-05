import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { readUser } from '@/lib/auth';
import { getDb } from '@/lib/db/connection';
import { newId } from '@/lib/ids';
import { jsonError, noSession, readJson } from '@/lib/http';
import { FeedbackRequestSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function issuesMessage(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

export async function POST(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const parsed = FeedbackRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', issuesMessage(parsed.error));
  }

  const { surface, rating, notebox_id, ai_call_id } = parsed.data;

  // SQLite treats NULLs as distinct in UNIQUE constraints, so dedupe explicitly.
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT 1 AS found FROM ai_feedback
       WHERE user_id = ? AND surface = ?
         AND COALESCE(ai_call_id, '') = ? AND COALESCE(notebox_id, '') = ?`,
    )
    .get(user.id, surface, ai_call_id ?? '', notebox_id ?? '');

  if (!existing) {
    db.prepare(
      `INSERT OR IGNORE INTO ai_feedback
         (id, user_id, ai_call_id, notebox_id, surface, rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId('fbk'), user.id, ai_call_id ?? null, notebox_id ?? null, surface, rating, Date.now());
  }

  return NextResponse.json({ ok: true });
}
