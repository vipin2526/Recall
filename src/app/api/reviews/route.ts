import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readUser } from '@/lib/auth';
import { applyReview } from '@/lib/db/queries';
import { jsonError, noSession, readIdempotencyKey, readJson, zodMessage } from '@/lib/http';
import { newId } from '@/lib/ids';
import { ReviewRequestSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const parsed = ReviewRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
      message: issue.message,
    }));
    return jsonError(400, 'invalid_input', zodMessage({ issues }), { issues });
  }

  const key = readIdempotencyKey(req, parsed.data.idempotency_key) ?? newId('idem');
  const result = applyReview(user.id, { ...parsed.data, idempotency_key: key });
  if (!result) return jsonError(404, 'not_found', 'Card not found.');

  if (result.duplicate) {
    return NextResponse.json({ review: result.review, notebox: result.notebox, duplicate: true });
  }
  return NextResponse.json({ review: result.review, notebox: result.notebox });
}
