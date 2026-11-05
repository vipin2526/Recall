import type { NextRequest } from 'next/server';
import type { ZodError } from 'zod';
import { readUser } from '@/lib/auth';
import { getCachedDraft } from '@/lib/ai/cache';
import { captureCacheKey, runCaptureWorkflow } from '@/lib/ai/capture';
import type { CaptureEvent } from '@/lib/ai/capture';
import { assertAiBudget, RateLimitError } from '@/lib/ai/limits';
import { jsonError, noSession, rateLimited, readJson } from '@/lib/http';
import { CaptureRequestSchema } from '@/lib/schemas';

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

  const parsed = CaptureRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return jsonError(400, 'invalid_request', issuesMessage(parsed.error));
  }
  const { source } = parsed.data;

  if (!getCachedDraft(captureCacheKey(source))) {
    try {
      assertAiBudget(user.id);
    } catch (err) {
      if (err instanceof RateLimitError) return rateLimited(err.retryAfterMs);
      return jsonError(
        500,
        'ai_unavailable',
        'AI is temporarily unavailable. You can still create cards by hand.',
      );
    }
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: string) => {
        if (closed || req.signal.aborted) {
          closed = true;
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          closed = true;
        }
      };

      const emit = (event: CaptureEvent) => send(JSON.stringify(event));
      const abort = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      req.signal.addEventListener('abort', abort, { once: true });

      try {
        await runCaptureWorkflow({ userId: user.id, source }, emit);
      } catch (err) {
        if (err instanceof RateLimitError) {
          send(
            JSON.stringify({
              type: 'error',
              code: 'rate_limited',
              message: "You've reached today's AI limit. You can still create the card by hand.",
            }),
          );
        } else {
          send(
            JSON.stringify({
              type: 'error',
              code: 'ai_failed',
              message: 'Something went wrong while drafting this card. You can still create it by hand.',
            }),
          );
        }
      } finally {
        req.signal.removeEventListener('abort', abort);
        if (!closed) {
          send('[DONE]');
          closed = true;
          try {
            controller.close();
          } catch {
            // stream already closed
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
