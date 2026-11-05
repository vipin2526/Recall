import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { readUser } from '@/lib/auth';
import { getUserStats } from '@/lib/db/queries';
import { noSession } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = readUser(req);
  if (!user) return noSession();

  return NextResponse.json(getUserStats(user.id));
}
