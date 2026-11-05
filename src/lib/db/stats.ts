import { getDb } from './connection';
import type { UserStats, WeeklyStats } from './types';
import { DAY_MS } from '../scheduler';

interface TotalsRow {
  total: number;
  due: number;
}

interface ReviewCountRow {
  reviews: number;
  remembered: number;
}

interface DayCountRow {
  day: number;
  reviews: number;
  remembered: number;
}

interface WeeklyCountRow {
  reviews: number;
  remembered: number;
  partial: number;
  forgot: number;
}

interface HardCardRow {
  notebox_id: string;
  title: string;
  misses: number;
}

export function startOfUtcDay(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

export function startOfUtcWeek(ts: number): number {
  const dayStart = startOfUtcDay(ts);
  const weekday = new Date(dayStart).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return dayStart - daysSinceMonday * DAY_MS;
}

export function toDateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function previousWeekStart(ts: number): number {
  return startOfUtcWeek(ts) - 7 * DAY_MS;
}

function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function reviewDayIndexes(userId: string): Set<number> {
  const rows = getDb()
    .prepare(
      `SELECT CAST(created_at / ? AS INTEGER) AS day
       FROM reviews
       WHERE user_id = ?
       GROUP BY day`,
    )
    .all(DAY_MS, userId) as Array<{ day: number }>;
  return new Set(rows.map((row) => row.day));
}

function computeStreak(userId: string, now: number): number {
  const days = reviewDayIndexes(userId);
  const today = Math.floor(now / DAY_MS);
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  let streak = 0;
  while (cursor !== null && days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

export function getUserStats(userId: string, now: number = Date.now()): UserStats {
  const db = getDb();
  const todayStart = startOfUtcDay(now);
  const reviewsWindowStart = todayStart - 13 * DAY_MS;
  const accuracyWindowStart = todayStart - 6 * DAY_MS;
  const forecastEnd = todayStart + 14 * DAY_MS;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN suspended = 0 AND due_at <= ? THEN 1 ELSE 0 END), 0) AS due
       FROM noteboxes
       WHERE user_id = ? AND deleted_at IS NULL`,
    )
    .get(now, userId) as TotalsRow;

  const todayReviews = db
    .prepare(
      `SELECT COUNT(*) AS reviews,
              COALESCE(SUM(CASE WHEN rating = 'remembered' THEN 1 ELSE 0 END), 0) AS remembered
       FROM reviews
       WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .get(userId, todayStart, now) as ReviewCountRow;

  const accuracyWindow = db
    .prepare(
      `SELECT COUNT(*) AS reviews,
              COALESCE(SUM(CASE WHEN rating = 'remembered' THEN 1 ELSE 0 END), 0) AS remembered
       FROM reviews
       WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
    )
    .get(userId, accuracyWindowStart, now) as ReviewCountRow;

  const stepRows = db
    .prepare(
      `SELECT step, COUNT(*) AS count
       FROM noteboxes
       WHERE user_id = ? AND deleted_at IS NULL
       GROUP BY step`,
    )
    .all(userId) as Array<{ step: number; count: number }>;
  const cardsByStep = new Array<number>(7).fill(0);
  for (const row of stepRows) {
    const index = Math.max(0, Math.min(6, row.step));
    cardsByStep[index] += row.count;
  }

  const dailyRows = db
    .prepare(
      `SELECT CAST(created_at / ? AS INTEGER) AS day,
              COUNT(*) AS reviews,
              COALESCE(SUM(CASE WHEN rating = 'remembered' THEN 1 ELSE 0 END), 0) AS remembered
       FROM reviews
       WHERE user_id = ? AND created_at >= ? AND created_at <= ?
       GROUP BY day`,
    )
    .all(DAY_MS, userId, reviewsWindowStart, now) as DayCountRow[];
  const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
  const reviewsByDay: UserStats['reviewsByDay'] = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const dayStart = todayStart - offset * DAY_MS;
    const entry = dailyMap.get(Math.floor(dayStart / DAY_MS));
    reviewsByDay.push({
      date: toDateKey(dayStart),
      reviews: entry?.reviews ?? 0,
      remembered: entry?.remembered ?? 0,
    });
  }

  const forecastRows = db
    .prepare(
      `SELECT CAST(due_at / ? AS INTEGER) AS day, COUNT(*) AS count
       FROM noteboxes
       WHERE user_id = ?
         AND deleted_at IS NULL
         AND suspended = 0
         AND due_at > ?
         AND due_at < ?
       GROUP BY day`,
    )
    .all(DAY_MS, userId, now, forecastEnd) as Array<{ day: number; count: number }>;
  const forecastMap = new Map(forecastRows.map((row) => [row.day, row.count]));
  const forecast: UserStats['forecast'] = [];
  for (let offset = 0; offset < 14; offset += 1) {
    const dayStart = todayStart + offset * DAY_MS;
    forecast.push({
      date: toDateKey(dayStart),
      count: forecastMap.get(Math.floor(dayStart / DAY_MS)) ?? 0,
    });
  }

  const tagRows = db
    .prepare('SELECT tags FROM noteboxes WHERE user_id = ? AND deleted_at IS NULL')
    .all(userId) as Array<{ tags: string }>;
  const tagCounts = new Map<string, number>();
  for (const row of tagRows) {
    for (const tag of parseTags(row.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const tags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, 8);

  return {
    totalCards: totals.total,
    dueNow: totals.due,
    reviewedToday: todayReviews.reviews,
    rememberedToday: todayReviews.remembered,
    accuracy7d: accuracyWindow.reviews > 0 ? accuracyWindow.remembered / accuracyWindow.reviews : 0,
    streakDays: computeStreak(userId, now),
    cardsByStep,
    reviewsByDay,
    forecast,
    tags,
  };
}

export function getWeeklyStats(userId: string, now: number = Date.now()): WeeklyStats {
  const db = getDb();
  const weekStart = startOfUtcWeek(now);
  const weekEnd = weekStart + 7 * DAY_MS;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN suspended = 0 AND due_at <= ? THEN 1 ELSE 0 END), 0) AS due
       FROM noteboxes
       WHERE user_id = ? AND deleted_at IS NULL`,
    )
    .get(now, userId) as TotalsRow;

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS reviews,
              COALESCE(SUM(CASE WHEN rating = 'remembered' THEN 1 ELSE 0 END), 0) AS remembered,
              COALESCE(SUM(CASE WHEN rating = 'partial' THEN 1 ELSE 0 END), 0) AS partial,
              COALESCE(SUM(CASE WHEN rating = 'forgot' THEN 1 ELSE 0 END), 0) AS forgot
       FROM reviews
       WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
    )
    .get(userId, weekStart, weekEnd) as WeeklyCountRow;

  const activeDaysRow = db
    .prepare(
      `SELECT COUNT(DISTINCT CAST(created_at / ? AS INTEGER)) AS days
       FROM reviews
       WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
    )
    .get(DAY_MS, userId, weekStart, weekEnd) as { days: number };

  const createdRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM noteboxes
       WHERE user_id = ? AND created_at >= ? AND created_at < ? AND deleted_at IS NULL`,
    )
    .get(userId, weekStart, weekEnd) as { count: number };

  const dailyRows = db
    .prepare(
      `SELECT CAST(created_at / ? AS INTEGER) AS day,
              COUNT(*) AS reviews,
              COALESCE(SUM(CASE WHEN rating = 'remembered' THEN 1 ELSE 0 END), 0) AS remembered
       FROM reviews
       WHERE user_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY day`,
    )
    .all(DAY_MS, userId, weekStart, weekEnd) as DayCountRow[];
  const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
  const byDay: WeeklyStats['byDay'] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const dayStart = weekStart + offset * DAY_MS;
    const entry = dailyMap.get(Math.floor(dayStart / DAY_MS));
    byDay.push({
      date: toDateKey(dayStart),
      reviews: entry?.reviews ?? 0,
      remembered: entry?.remembered ?? 0,
    });
  }

  const hardestRows = db
    .prepare(
      `SELECT r.notebox_id AS notebox_id, n.title AS title, COUNT(*) AS misses
       FROM reviews r
       JOIN noteboxes n ON n.id = r.notebox_id
       WHERE r.user_id = ?
         AND r.created_at >= ?
         AND r.created_at < ?
         AND r.rating IN ('forgot', 'partial')
         AND n.deleted_at IS NULL
       GROUP BY r.notebox_id
       ORDER BY misses DESC, r.notebox_id ASC
       LIMIT 3`,
    )
    .all(userId, weekStart, weekEnd) as HardCardRow[];

  return {
    weekStart: toDateKey(weekStart),
    weekEnd: toDateKey(weekEnd),
    reviews: counts.reviews,
    remembered: counts.remembered,
    partial: counts.partial,
    forgot: counts.forgot,
    accuracy: counts.reviews > 0 ? counts.remembered / counts.reviews : 0,
    activeDays: activeDaysRow.days,
    streakDays: computeStreak(userId, now),
    cardsCreated: createdRow.count,
    totalCards: totals.total,
    dueCount: totals.due,
    hardest: hardestRows.map((row) => ({
      noteboxId: row.notebox_id,
      title: row.title,
      misses: row.misses,
    })),
    byDay,
  };
}
