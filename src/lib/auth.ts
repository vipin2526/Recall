import type { NextRequest } from 'next/server';
import { getDb } from './db/connection';
import type { User } from './db/types';
import { newId } from './ids';
import { LIMITS } from './schemas';

export const USER_COOKIE = 'recall_uid';

interface UserRow {
  id: string;
  created_at: number;
  plan: string;
  daily_ai_limit: number;
  partial_counts_as: string;
  ai_grading: number;
}

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    createdAt: row.created_at,
    plan: row.plan,
    dailyAiLimit: row.daily_ai_limit,
    partialCountsAs: row.partial_counts_as === 'remembered' ? 'remembered' : 'forgot',
    aiGrading: row.ai_grading === 1,
  };
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function readUser(req: NextRequest): User | null {
  const id = req.cookies.get(USER_COOKIE)?.value;
  return id ? getUserById(id) : null;
}

export function getOrCreateUser(req: NextRequest): { user: User; created: boolean } {
  const existing = readUser(req);
  if (existing) return { user: existing, created: false };

  const envLimit = Number(process.env.AI_DAILY_LIMIT);
  const limit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : LIMITS.dailyFreeAiCalls;
  const id = newId('usr');
  getDb()
    .prepare(
      'INSERT INTO users (id, created_at, plan, daily_ai_limit) VALUES (?, ?, ?, ?)',
    )
    .run(id, Date.now(), 'free', limit);

  const user = getUserById(id);
  if (!user) throw new Error('failed to create user');
  return { user, created: true };
}
