import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readUser } from '@/lib/auth';
import { createNotebox, listNoteboxes } from '@/lib/db/queries';
import { jsonError, noSession, readIdempotencyKey, readJson, zodMessage } from '@/lib/http';
import { CreateNoteboxSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function intParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const { searchParams } = new URL(req.url);
  const result = listNoteboxes(user.id, {
    query: searchParams.get('query') ?? undefined,
    tag: searchParams.get('tag') ?? undefined,
    limit: intParam(searchParams.get('limit')),
    offset: intParam(searchParams.get('offset')),
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const parsed = CreateNoteboxSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
      message: issue.message,
    }));
    return jsonError(400, 'invalid_input', zodMessage({ issues }), { issues });
  }

  const key = readIdempotencyKey(req, parsed.data.idempotency_key);
  const result = createNotebox(user.id, parsed.data, { idempotencyKey: key });

  if (result.idempotentReplay) {
    return NextResponse.json({ notebox: result.notebox, idempotentReplay: true });
  }
  if (result.duplicate) {
    return NextResponse.json({ notebox: result.notebox, duplicate: true });
  }
  return NextResponse.json({ notebox: result.notebox }, { status: 201 });
}
