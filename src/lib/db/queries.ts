import { getUserById } from '../auth';
import { getAiStatus } from '../ai/status';
import { newId } from '../ids';
import { applyRating } from '../scheduler';
import { LIMITS } from '../schemas';
import type { CreateNoteboxInput, Rating, ReviewRequest } from '../schemas';
import { getDb, tx } from './connection';
import { startOfUtcDay } from './stats';
import type { Notebox, Review, SessionInfo, User } from './types';

interface NoteboxRow {
  id: string;
  user_id: string;
  title: string;
  key_points: string;
  recall_prompt: string;
  tags: string;
  source_url: string | null;
  source_hash: string | null;
  step: number;
  due_at: number;
  created_at: number;
  updated_at: number;
  suspended: number;
  deleted_at: number | null;
}

interface ReviewRow {
  id: string;
  user_id: string;
  notebox_id: string;
  idempotency_key: string;
  rating: string;
  verdict: string | null;
  answer: string | null;
  feedback: string | null;
  step_before: number;
  step_after: number;
  interval_days: number;
  due_at: number;
  ai_used: number;
  created_at: number;
}

export interface ListNoteboxesOptions {
  query?: string;
  tag?: string;
  limit?: number;
  offset?: number;
  includeSuspended?: boolean;
}

export interface CreateNoteboxOptions {
  idempotencyKey?: string | null;
}

export interface CreateNoteboxResult {
  notebox: Notebox;
  duplicate: boolean;
  idempotentReplay: boolean;
}

export interface UpdateNoteboxPatch {
  title?: string;
  key_points?: string[];
  recall_prompt?: string;
  tags?: string[];
  suspended?: boolean;
}

export interface ApplyReviewResult {
  review: Review;
  notebox: Notebox;
  duplicate: boolean;
}

export interface TodayResult {
  due: Notebox[];
  counts: { due: number; total: number; reviewedToday: number; rememberedToday: number };
}

export interface UserSettingsPatch {
  partial_counts_as?: 'forgot' | 'remembered';
  ai_grading?: boolean;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parseStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().slice(0, LIMITS.tagMaxChars);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
    if (normalized.length >= LIMITS.tagsMax) break;
  }
  return normalized;
}

function normalizeKeyPoints(points: readonly string[]): string[] {
  return points
    .map((point) => point.trim().slice(0, LIMITS.keyPointMaxChars))
    .filter((point) => point.length > 0)
    .slice(0, LIMITS.keyPointsMax);
}

export function mapNoteboxRow(row: NoteboxRow): Notebox {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    keyPoints: parseStringArray(row.key_points),
    recallPrompt: row.recall_prompt,
    tags: parseStringArray(row.tags),
    sourceUrl: row.source_url,
    sourceHash: row.source_hash,
    step: row.step,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    suspended: row.suspended === 1,
    deletedAt: row.deleted_at,
  };
}

function mapReviewRow(row: ReviewRow): Review {
  return {
    id: row.id,
    userId: row.user_id,
    noteboxId: row.notebox_id,
    rating: row.rating as Rating,
    verdict: row.verdict as Rating | null,
    answer: row.answer,
    feedback: row.feedback,
    stepBefore: row.step_before,
    stepAfter: row.step_after,
    intervalDays: row.interval_days,
    dueAt: row.due_at,
    aiUsed: row.ai_used === 1,
    createdAt: row.created_at,
  };
}

function findNoteboxRow(userId: string, id: string, includeDeleted = false): NoteboxRow | undefined {
  const sql = includeDeleted
    ? 'SELECT * FROM noteboxes WHERE user_id = ? AND id = ?'
    : 'SELECT * FROM noteboxes WHERE user_id = ? AND id = ? AND deleted_at IS NULL';
  return getDb().prepare(sql).get(userId, id) as NoteboxRow | undefined;
}

export function getNotebox(userId: string, id: string): Notebox | null {
  const row = findNoteboxRow(userId, id);
  return row ? mapNoteboxRow(row) : null;
}

export function listNoteboxes(
  userId: string,
  opts: ListNoteboxesOptions = {},
): { items: Notebox[]; total: number } {
  const conditions: string[] = ['user_id = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [userId];

  const query = opts.query?.trim();
  if (query) {
    const pattern = `%${escapeLike(query.toLowerCase())}%`;
    conditions.push("(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(key_points) LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  const tag = opts.tag?.trim().toLowerCase();
  if (tag) {
    conditions.push("LOWER(tags) LIKE ? ESCAPE '\\'");
    params.push(`%"${escapeLike(tag)}"%`);
  }

  if (!opts.includeSuspended) conditions.push('suspended = 0');

  const where = conditions.join(' AND ');
  const limit = clampInt(opts.limit, 50, 1, 200);
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));

  const rows = getDb()
    .prepare(`SELECT * FROM noteboxes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as NoteboxRow[];
  const total = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM noteboxes WHERE ${where}`)
    .get(...params) as { count: number };

  return { items: rows.map(mapNoteboxRow), total: total.count };
}

export function listDueNoteboxes(userId: string, now: number, limit?: number): Notebox[] {
  const safeLimit = clampInt(limit, 30, 1, 100);
  const rows = getDb()
    .prepare(
      `SELECT * FROM noteboxes
       WHERE user_id = ? AND deleted_at IS NULL AND suspended = 0 AND due_at <= ?
       ORDER BY due_at ASC, created_at ASC
       LIMIT ?`,
    )
    .all(userId, now, safeLimit) as NoteboxRow[];
  return rows.map(mapNoteboxRow);
}

export function createNotebox(
  userId: string,
  input: CreateNoteboxInput,
  opts?: CreateNoteboxOptions,
): CreateNoteboxResult {
  const db = getDb();
  return tx(() => {
    const key = opts?.idempotencyKey?.trim() || input.idempotency_key?.trim() || null;

    if (key) {
      const dedup = db
        .prepare('SELECT notebox_id FROM capture_dedup WHERE user_id = ? AND idempotency_key = ?')
        .get(userId, key) as { notebox_id: string } | undefined;
      if (dedup) {
        const existing = findNoteboxRow(userId, dedup.notebox_id, true);
        if (existing) {
          return { notebox: mapNoteboxRow(existing), duplicate: false, idempotentReplay: true };
        }
      }
    }

    if (input.source_hash) {
      const duplicate = db
        .prepare(
          `SELECT * FROM noteboxes
           WHERE user_id = ? AND source_hash = ? AND deleted_at IS NULL
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get(userId, input.source_hash) as NoteboxRow | undefined;
      if (duplicate) {
        return { notebox: mapNoteboxRow(duplicate), duplicate: true, idempotentReplay: false };
      }
    }

    const now = Date.now();
    const id = newId('nbx');
    db.prepare(
      `INSERT INTO noteboxes
         (id, user_id, title, key_points, recall_prompt, tags, source_url, source_hash,
          step, due_at, created_at, updated_at, suspended, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, NULL)`,
    ).run(
      id,
      userId,
      input.title.trim(),
      JSON.stringify(normalizeKeyPoints(input.key_points)),
      input.recall_prompt.trim(),
      JSON.stringify(normalizeTags(input.tags)),
      input.source_url ?? null,
      input.source_hash ?? null,
      now,
      now,
      now,
    );

    if (key) {
      db.prepare(
        `INSERT INTO capture_dedup (user_id, idempotency_key, notebox_id, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, idempotency_key) DO NOTHING`,
      ).run(userId, key, id, now);
    }

    const row = findNoteboxRow(userId, id);
    if (!row) throw new Error('failed to create notebox');
    return { notebox: mapNoteboxRow(row), duplicate: false, idempotentReplay: false };
  });
}

export function updateNotebox(userId: string, id: string, patch: UpdateNoteboxPatch): Notebox | null {
  const db = getDb();
  return tx(() => {
    const existing = findNoteboxRow(userId, id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title.trim());
    }
    if (patch.key_points !== undefined) {
      sets.push('key_points = ?');
      params.push(JSON.stringify(normalizeKeyPoints(patch.key_points)));
    }
    if (patch.recall_prompt !== undefined) {
      sets.push('recall_prompt = ?');
      params.push(patch.recall_prompt.trim());
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(normalizeTags(patch.tags)));
    }
    if (patch.suspended !== undefined) {
      sets.push('suspended = ?');
      params.push(patch.suspended ? 1 : 0);
    }
    sets.push('updated_at = ?');
    params.push(Date.now());

    db.prepare(`UPDATE noteboxes SET ${sets.join(', ')} WHERE user_id = ? AND id = ? AND deleted_at IS NULL`).run(
      ...params,
      userId,
      id,
    );

    const row = findNoteboxRow(userId, id);
    return row ? mapNoteboxRow(row) : null;
  });
}

export function softDeleteNotebox(userId: string, id: string): boolean {
  const now = Date.now();
  const result = getDb()
    .prepare('UPDATE noteboxes SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL')
    .run(now, now, userId, id);
  return result.changes > 0;
}

export function applyReview(
  userId: string,
  input: ReviewRequest & { idempotency_key?: string },
  now: number = Date.now(),
): ApplyReviewResult | null {
  const db = getDb();
  return tx(() => {
    const card = findNoteboxRow(userId, input.notebox_id);
    if (!card) return null;

    const key = input.idempotency_key?.trim() || null;
    if (key) {
      const existing = db
        .prepare('SELECT * FROM reviews WHERE user_id = ? AND idempotency_key = ?')
        .get(userId, key) as ReviewRow | undefined;
      if (existing) {
        return { review: mapReviewRow(existing), notebox: mapNoteboxRow(card), duplicate: true };
      }
    }

    const user = getUserById(userId);
    const schedule = applyRating({
      step: card.step,
      rating: input.rating,
      partialCountsAs: user?.partialCountsAs,
      now,
    });

    db.prepare(
      'UPDATE noteboxes SET step = ?, due_at = ?, updated_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL',
    ).run(schedule.step, schedule.dueAt, now, userId, card.id);

    const reviewId = newId('rev');
    db.prepare(
      `INSERT INTO reviews
         (id, user_id, notebox_id, idempotency_key, rating, verdict, answer, feedback,
          step_before, step_after, interval_days, due_at, ai_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      reviewId,
      userId,
      card.id,
      key ?? newId('idem'),
      input.rating,
      input.verdict ?? null,
      input.answer ?? null,
      input.feedback ?? null,
      card.step,
      schedule.step,
      schedule.intervalDays,
      schedule.dueAt,
      input.ai_used ? 1 : 0,
      now,
    );

    const reviewRow = db.prepare('SELECT * FROM reviews WHERE id = ?').get(reviewId) as ReviewRow | undefined;
    const updatedCard = findNoteboxRow(userId, card.id);
    if (!reviewRow || !updatedCard) throw new Error('failed to apply review');
    return { review: mapReviewRow(reviewRow), notebox: mapNoteboxRow(updatedCard), duplicate: false };
  });
}

export function listReviews(userId: string, noteboxId: string, limit = 20): Review[] {
  const safeLimit = clampInt(limit, 20, 1, 100);
  const rows = getDb()
    .prepare(
      `SELECT * FROM reviews
       WHERE user_id = ? AND notebox_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, noteboxId, safeLimit) as ReviewRow[];
  return rows.map(mapReviewRow);
}

export function getToday(userId: string, now: number = Date.now(), limit?: number): TodayResult {
  const db = getDb();
  const due = listDueNoteboxes(userId, now, limit);
  const todayStart = startOfUtcDay(now);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN suspended = 0 AND due_at <= ? THEN 1 ELSE 0 END), 0) AS due
       FROM noteboxes
       WHERE user_id = ? AND deleted_at IS NULL`,
    )
    .get(now, userId) as { total: number; due: number };

  const todayReviews = db
    .prepare(
      `SELECT COUNT(*) AS reviews,
              COALESCE(SUM(CASE WHEN rating = 'remembered' THEN 1 ELSE 0 END), 0) AS remembered
       FROM reviews
       WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .get(userId, todayStart, now) as { reviews: number; remembered: number };

  return {
    due,
    counts: {
      due: totals.due,
      total: totals.total,
      reviewedToday: todayReviews.reviews,
      rememberedToday: todayReviews.remembered,
    },
  };
}

export function countAiCallsToday(userId: string, now: number = Date.now()): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM ai_calls WHERE user_id = ? AND cached = 0 AND created_at >= ?')
    .get(userId, startOfUtcDay(now)) as { count: number };
  return row.count;
}

export function getSessionInfo(user: User, now: number = Date.now()): SessionInfo {
  const usedToday = countAiCallsToday(user.id, now);
  return {
    user: {
      id: user.id,
      plan: user.plan,
      dailyAiLimit: user.dailyAiLimit,
      usedToday,
      remainingToday: Math.max(0, user.dailyAiLimit - usedToday),
      partialCountsAs: user.partialCountsAs,
      aiGrading: user.aiGrading,
    },
    ai: getAiStatus(),
  };
}

export function updateUserSettings(userId: string, patch: UserSettingsPatch): User | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.partial_counts_as !== undefined) {
    sets.push('partial_counts_as = ?');
    params.push(patch.partial_counts_as);
  }
  if (patch.ai_grading !== undefined) {
    sets.push('ai_grading = ?');
    params.push(patch.ai_grading ? 1 : 0);
  }
  if (sets.length > 0) {
    params.push(userId);
    getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  return getUserById(userId);
}

export { getUserStats, getWeeklyStats } from './stats';
