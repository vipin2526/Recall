import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readUser } from '@/lib/auth';
import { getToday } from '@/lib/db/queries';
import { noSession } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get('limit');
  const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
  const limit = parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined;

  return NextResponse.json(getToday(user.id, Date.now(), limit));
}
