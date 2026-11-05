import { getDb } from '../db/connection';
import { DAY_MS } from '../scheduler';
import { CaptureDraftSchema } from '../schemas';
import type { CaptureDraft } from '../schemas';

const TTL_MS = 30 * DAY_MS;

export interface CachedDraft {
  draft: CaptureDraft;
  kind: string;
  createdAt: number;
}

interface CacheRow {
  hash: string;
  kind: string;
  payload: string;
  created_at: number;
}

export function getCachedDraft(hash: string): CachedDraft | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_cache WHERE hash = ?').get(hash) as
    | CacheRow
    | undefined;
  if (!row) return null;

  if (Date.now() - row.created_at > TTL_MS) {
    db.prepare('DELETE FROM ai_cache WHERE hash = ?').run(hash);
    return null;
  }

  try {
    const parsed = CaptureDraftSchema.safeParse(JSON.parse(row.payload));
    if (!parsed.success) {
      db.prepare('DELETE FROM ai_cache WHERE hash = ?').run(hash);
      return null;
    }
    return { draft: parsed.data, kind: row.kind, createdAt: row.created_at };
  } catch {
    db.prepare('DELETE FROM ai_cache WHERE hash = ?').run(hash);
    return null;
  }
}

export function setCachedDraft(hash: string, draft: CaptureDraft, kind: string): void {
  const valid = CaptureDraftSchema.safeParse(draft);
  if (!valid.success) return;
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO ai_cache (hash, kind, payload, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(hash, kind, JSON.stringify(valid.data), Date.now());
}
