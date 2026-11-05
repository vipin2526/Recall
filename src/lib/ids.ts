import { createHash, randomUUID } from 'node:crypto';

export function newId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id.replaceAll('-', '')}` : id;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.hash = '';
  // Strip common tracking params so the same article hits the same cache entry.
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || /^(fbclid|gclid|ref|source)$/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  if (url.pathname.endsWith('/') && url.pathname !== '/') {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}
