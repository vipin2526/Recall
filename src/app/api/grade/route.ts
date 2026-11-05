import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { readUser } from '@/lib/auth';
import { getDb } from '@/lib/db/connection';
import { gradeAnswer } from '@/lib/ai/grader';
import { assertAiBudget, RateLimitError } from '@/lib/ai/limits';
import { getAiStatus } from '@/lib/ai/status';
import { jsonError, noSession, rateLimited, readJson } from '@/lib/http';
import { GradeRequestSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function issuesMessage(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

interface NoteboxRow {
  key_points: string;
  recall_prompt: string;
}

function parseKeyPoints(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((point): point is string => typeof point === 'string')
      .map((point) => point.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const parsed = GradeRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', issuesMessage(parsed.error));
  }

  const row = getDb()
    .prepare(
      'SELECT key_points, recall_prompt FROM noteboxes WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    )
    .get(parsed.data.notebox_id, user.id) as NoteboxRow | undefined;

  if (!row) {
    return jsonError(404, 'not_found', 'That card no longer exists.');
  }

  if (!user.aiGrading) {
    return NextResponse.json({
      result: null,
      aiCallId: null,
      provider: 'unavailable',
      model: getAiStatus().model,
      error: 'AI grading is off',
    });
  }

  try {
    assertAiBudget(user.id);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimited(err.retryAfterMs);
    return jsonError(500, 'ai_unavailable', 'AI grading is unavailable right now.');
  }

  try {
    const outcome = await gradeAnswer({
      userId: user.id,
      recallPrompt: row.recall_prompt,
      keyPoints: parseKeyPoints(row.key_points),
      answer: parsed.data.answer,
    });

    return NextResponse.json({
      result: outcome.result,
      aiCallId: outcome.aiCallId,
      provider: outcome.provider,
      model: outcome.model,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
  } catch {
    return NextResponse.json({
      result: null,
      aiCallId: null,
      provider: 'unavailable',
      model: getAiStatus().model,
      error: 'AI grading is unavailable right now. Grade this card yourself.',
    });
  }
}
