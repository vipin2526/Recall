import type { PartialBehavior } from '../scheduler';
import type { Rating } from '../schemas';

export interface User {
  id: string;
  createdAt: number;
  plan: string;
  dailyAiLimit: number;
  partialCountsAs: PartialBehavior;
  aiGrading: boolean;
}

export interface Notebox {
  id: string;
  userId: string;
  title: string;
  keyPoints: string[];
  recallPrompt: string;
  tags: string[];
  sourceUrl: string | null;
  sourceHash: string | null;
  step: number;
  dueAt: number;
  createdAt: number;
  updatedAt: number;
  suspended: boolean;
  deletedAt: number | null;
}

export interface Review {
  id: string;
  userId: string;
  noteboxId: string;
  rating: Rating;
  verdict: Rating | null;
  answer: string | null;
  feedback: string | null;
  stepBefore: number;
  stepAfter: number;
  intervalDays: number;
  dueAt: number;
  aiUsed: boolean;
  createdAt: number;
}

export interface AiCall {
  id: string;
  userId: string | null;
  kind: 'capture' | 'grade' | 'coach';
  model: string;
  provider: 'anthropic' | 'mock';
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  ok: boolean;
  validationOk: boolean;
  cached: boolean;
  error: string | null;
  createdAt: number;
}

export interface CoachReport {
  id: string;
  userId: string;
  weekStart: string;
  summary: { headline: string; lines: string[] };
  stats: WeeklyStats;
  createdAt: number;
}

export interface WeeklyStats {
  weekStart: string;
  weekEnd: string;
  reviews: number;
  remembered: number;
  partial: number;
  forgot: number;
  /** remembered / reviews, 0..1 */
  accuracy: number;
  activeDays: number;
  streakDays: number;
  cardsCreated: number;
  totalCards: number;
  dueCount: number;
  hardest: Array<{ noteboxId: string; title: string; misses: number }>;
  byDay: Array<{ date: string; reviews: number; remembered: number }>;
}

export interface UserStats {
  totalCards: number;
  dueNow: number;
  reviewedToday: number;
  rememberedToday: number;
  accuracy7d: number;
  streakDays: number;
  cardsByStep: number[];
  reviewsByDay: Array<{ date: string; reviews: number; remembered: number }>;
  forecast: Array<{ date: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
}

export interface SessionInfo {
  user: {
    id: string;
    plan: string;
    dailyAiLimit: number;
    usedToday: number;
    remainingToday: number;
    partialCountsAs: PartialBehavior;
    aiGrading: boolean;
  };
  ai: {
    mode: 'live' | 'mock';
    model: string;
  };
}

export interface MonitorSummary {
  windowHours: number;
  totalCalls: number;
  validationFailRate: number;
  p95LatencyMs: number;
  avgLatencyMs: number;
  costUsd: number;
  cacheHitRate: number;
  byKind: Array<{
    kind: string;
    calls: number;
    validationFailRate: number;
    p95LatencyMs: number;
    costUsd: number;
  }>;
  recent: Array<{
    id: string;
    kind: string;
    provider: string;
    model: string;
    latencyMs: number;
    validationOk: boolean;
    cached: boolean;
    costUsd: number;
    createdAt: number;
    error: string | null;
  }>;
  alerts: Array<{ level: 'warn' | 'error'; message: string }>;
  feedback: { up: number; down: number };
}
