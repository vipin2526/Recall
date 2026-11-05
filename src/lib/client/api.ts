/**
 * One place for JSON requests, error normalization and SSE parsing.
 * Every call is same-origin and cookie-authenticated.
 */

export interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
    retryAfterMs?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs?: number;

  constructor(status: number, code: string, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

type UnauthorizedHandler = () => Promise<void>;

let unauthorizedHandler: UnauthorizedHandler | null = null;
let refreshing: Promise<void> | null = null;

/** SessionProvider registers a handler so a stale cookie is refreshed once and retried. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

async function refreshSessionOnce(): Promise<void> {
  if (!unauthorizedHandler) return;
  if (!refreshing) {
    refreshing = unauthorizedHandler()
      .catch(() => undefined)
      .finally(() => {
        refreshing = null;
      });
  }
  await refreshing;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

function defaultMessage(status: number): string {
  if (status === 401) return 'Your session expired. Reloading should fix it.';
  if (status === 404) return 'That item could not be found.';
  if (status === 429) return "You've reached today's AI limit.";
  if (status >= 500) return 'Something went wrong on our side. Try again in a moment.';
  return 'The request could not be completed.';
}

async function normalizeError(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`;
  let message = defaultMessage(response.status);
  let retryAfterMs: number | undefined;

  const headerRetry = Number(response.headers.get('retry-after'));
  if (Number.isFinite(headerRetry) && headerRetry > 0) retryAfterMs = headerRetry * 1000;

  try {
    const body = (await response.json()) as ApiErrorPayload;
    const error = body?.error;
    if (error) {
      if (typeof error.code === 'string' && error.code) code = error.code;
      if (typeof error.message === 'string' && error.message) message = error.message;
      if (typeof error.retryAfterMs === 'number') retryAfterMs = error.retryAfterMs;
    }
  } catch {
    // Non-JSON error bodies keep the status defaults.
  }

  return new ApiError(response.status, code, message, retryAfterMs);
}

interface RequestOptions {
  method: string;
  body?: unknown;
  signal?: AbortSignal;
  retryOnAuth?: boolean;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method,
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'network_error', 'Could not reach Recall. Check your connection.');
  }

  if (response.status === 401 && options.retryOnAuth !== false) {
    await refreshSessionOnce();
    return request<T>(path, { ...options, retryOnAuth: false });
  }

  if (!response.ok) throw await normalizeError(response);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'bad_response', 'The server sent an unexpected response.');
  }
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'GET', signal });
}

export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', body, signal });
}

export function apiPatch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'PATCH', body, signal });
}

export function apiDelete<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'DELETE', signal });
}

/**
 * Opens a streaming POST. Status errors are normalized into ApiError so callers
 * can fall back to a manual path; a successful response is handed to readSseStream.
 */
export async function apiStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  retryOnAuth = true,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'network_error', 'Could not reach Recall. Check your connection.');
  }

  if (response.status === 401 && retryOnAuth) {
    await refreshSessionOnce();
    return apiStream(path, body, signal, false);
  }

  if (!response.ok) throw await normalizeError(response);
  return response;
}

function parseEventData(block: string): string | null {
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n').trim();
  return data.length > 0 ? data : null;
}

/**
 * Reads `data: {json}\n\n` events until `data: [DONE]\n\n`. Chunks can split an
 * event, so we keep a buffer and only decode complete blocks.
 */
export async function readSseStream<T>(
  response: Response,
  onEvent: (event: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) {
    throw new ApiError(response.status, 'empty_stream', 'The stream ended before it started.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleBlock = (block: string): boolean => {
    const data = parseEventData(block);
    if (!data) return false;
    if (data === '[DONE]') return true;
    try {
      onEvent(JSON.parse(data) as T);
    } catch {
      // Ignore malformed frames; the next event may still be usable.
    }
    return false;
  };

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort);

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (handleBlock(block)) return;
        boundary = buffer.indexOf('\n\n');
      }

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    }

    buffer += decoder.decode();
    if (buffer.trim()) handleBlock(buffer);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}
