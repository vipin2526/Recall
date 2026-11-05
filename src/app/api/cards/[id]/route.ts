import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { readUser } from '@/lib/auth';
import { getNotebox, listReviews, softDeleteNotebox, updateNotebox } from '@/lib/db/queries';
import { jsonError, noSession, readJson, zodMessage } from '@/lib/http';
import { LIMITS } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PatchNoteboxSchema = z.object({
  title: z.string().min(1).max(LIMITS.titleMaxChars).optional(),
  key_points: z
    .array(z.string().min(1).max(LIMITS.keyPointMaxChars))
    .min(1)
    .max(LIMITS.keyPointsMax)
    .optional(),
  recall_prompt: z.string().min(3).max(LIMITS.recallPromptMaxChars).optional(),
  tags: z.array(z.string().min(1).max(LIMITS.tagMaxChars)).max(LIMITS.tagsMax).optional(),
  suspended: z.boolean().optional(),
});

type CardRouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: CardRouteContext) {
  const user = readUser(req);
  if (!user) return noSession();

  const { id } = await params;
  const notebox = getNotebox(user.id, id);
  if (!notebox) return jsonError(404, 'not_found', 'Card not found.');

  return NextResponse.json({ notebox, reviews: listReviews(user.id, id, 20) });
}

export async function PATCH(req: NextRequest, { params }: CardRouteContext) {
  const user = readUser(req);
  if (!user) return noSession();

  const parsed = PatchNoteboxSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
      message: issue.message,
    }));
    return jsonError(400, 'invalid_input', zodMessage({ issues }), { issues });
  }

  const { id } = await params;
  const notebox = updateNotebox(user.id, id, parsed.data);
  if (!notebox) return jsonError(404, 'not_found', 'Card not found.');

  return NextResponse.json({ notebox });
}

export async function DELETE(req: NextRequest, { params }: CardRouteContext) {
  const user = readUser(req);
  if (!user) return noSession();

  const { id } = await params;
  if (!softDeleteNotebox(user.id, id)) {
    return jsonError(404, 'not_found', 'Card not found.');
  }
  return NextResponse.json({ ok: true });
}
