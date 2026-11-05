import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export interface ApiErrorBody {
  error: { code: string; message: string; [key: string]: unknown };
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export function noSession(): NextResponse<ApiErrorBody> {
  return jsonError(401, 'no_session', 'No session yet. Reload the app to start one.');
}

export function rateLimited(retryAfterMs: number): NextResponse<ApiErrorBody> {
  return jsonError(429, 'rate_limited', "You've reached today's AI limit.", {
    retryAfterMs,
  });
}

export function readIdempotencyKey(req: NextRequest, bodyKey?: string): string | null {
  return bodyKey?.trim() || req.headers.get('idempotency-key')?.trim() || null;
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function zodMessage(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}
