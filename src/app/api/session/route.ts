import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrCreateUser, readUser, USER_COOKIE } from '@/lib/auth';
import { getSessionInfo, updateUserSettings } from '@/lib/db/queries';
import { jsonError, noSession, readJson, zodMessage } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SessionPatchSchema = z.object({
  partial_counts_as: z.enum(['forgot', 'remembered']).optional(),
  ai_grading: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const { user } = getOrCreateUser(req);
  const response = NextResponse.json(getSessionInfo(user));
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const secure = req.nextUrl.protocol === 'https:' || forwardedProto === 'https';
  response.cookies.set(USER_COOKIE, user.id, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure,
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export async function PATCH(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const parsed = SessionPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
      message: issue.message,
    }));
    return jsonError(400, 'invalid_input', zodMessage({ issues }), { issues });
  }

  const updated = updateUserSettings(user.id, parsed.data);
  if (!updated) return noSession();

  return NextResponse.json({ user: getSessionInfo(updated).user });
}
