import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeUrl } from '../ids';
import { LIMITS } from '../schemas';
import type { CaptureSource } from '../schemas';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class DocumentError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
  }
}

export interface ExtractedDocument {
  text: string;
  title?: string;
  url?: string;
}

function normalizeText(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.titleMaxChars);
  return cleaned.length >= 3 ? cleaned : undefined;
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let seen = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      seen += value.byteLength;
      if (seen > maxBytes) {
        const keep = value.byteLength - (seen - maxBytes);
        text += decoder.decode(value.subarray(0, Math.max(0, keep)), { stream: true });
        await reader.cancel().catch(() => undefined);
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return text;
}

function isAbortLike(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError' || /abort|timeout/i.test(err.message))
  );
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('::ffff:')
    );
  }
  return false;
}

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(?:localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new DocumentError('blocked_url', 'That link points to a private address, so it cannot be captured.');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new DocumentError('blocked_url', 'That link points to a private address, so it cannot be captured.');
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new DocumentError('fetch_failed', 'We could not resolve that link. Check the URL or paste the text instead.');
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new DocumentError('blocked_url', 'That link points to a private address, so it cannot be captured.');
  }
}

async function fetchHtml(url: string): Promise<string> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new DocumentError('bad_url', 'That link is not a valid URL.');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(current);

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch (err) {
      if (isAbortLike(err)) {
        throw new DocumentError('fetch_timeout', 'That page took too long to load. Try again or paste the text.');
      }
      throw new DocumentError('fetch_failed', 'We could not reach that link. Check the URL or paste the text instead.');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        break;
      }
      if (!/^https?:$/.test(next.protocol)) {
        throw new DocumentError('blocked_url', 'That link redirects to a location that cannot be captured.');
      }
      current = next;
      continue;
    }

    if (!response.ok) {
      throw new DocumentError(
        'fetch_failed',
        `That page could not be loaded (HTTP ${response.status}). Paste the text instead.`,
      );
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new DocumentError('not_html', 'That link is not an article page. Paste the text instead.');
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new DocumentError('too_large', 'That page is too large to process. Paste the relevant text instead.');
    }

    return readBodyCapped(response, MAX_BODY_BYTES);
  }

  throw new DocumentError('too_many_redirects', 'That link redirected too many times. Paste the text instead.');
}

function parseHtml(html: string, url: string): { text: string; title?: string } {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    throw new DocumentError('parse_failed', 'We could not read that page. Paste the text instead.');
  }

  const doc = dom.window.document;
  doc.querySelectorAll('script, style, noscript, template, svg, iframe').forEach((node) => node.remove());

  let title = cleanTitle(doc.title);
  let text = '';

  try {
    // Readability is typed against the DOM lib Document; jsdom's runtime document is compatible.
    const article = new Readability(doc as unknown as Document).parse();
    if (article?.textContent?.trim()) {
      text = article.textContent;
      title = cleanTitle(article.title) ?? title;
    }
  } catch {
    text = '';
  }

  if (!text.trim()) {
    text = doc.body?.textContent ?? '';
    if (!title) {
      const heading = doc.querySelector('h1, h2')?.textContent;
      title = cleanTitle(heading);
    }
  }

  return { text, title };
}

export async function extractText(source: CaptureSource): Promise<ExtractedDocument> {
  if (source.kind === 'text') {
    const text = normalizeText(source.text).slice(0, LIMITS.sourceTextMaxChars);
    if (text.length < 20) {
      throw new DocumentError('empty_source', 'That text is too short to turn into a card.');
    }
    return { text, title: cleanTitle(source.title) };
  }

  let url: string;
  try {
    url = normalizeUrl(source.url);
  } catch {
    throw new DocumentError('bad_url', 'That link is not a valid URL.');
  }

  if (!/^https?:/i.test(url)) {
    throw new DocumentError('bad_url', 'Only http and https links can be captured.');
  }

  const html = await fetchHtml(url);
  if (!html.trim()) {
    throw new DocumentError('empty_page', 'That page returned no content. Paste the text instead.');
  }

  const parsed = parseHtml(html, url);
  const text = normalizeText(parsed.text);
  if (text.length < 20) {
    throw new DocumentError('empty_page', 'We could not find readable text on that page. Paste the text instead.');
  }

  return {
    text: text.slice(0, LIMITS.sourceTextMaxChars),
    title: parsed.title,
    url,
  };
}
