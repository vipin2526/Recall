import type {
  CoachReport,
  MonitorSummary,
  Notebox,
  Review,
  UserStats,
} from '@/lib/db/types';
import type { CaptureDraft, GradeResult } from '@/lib/schemas';

export interface TodayCounts {
  due: number;
  total: number;
  reviewedToday: number;
  rememberedToday: number;
}

export interface TodayResponse {
  due: Notebox[];
  counts: TodayCounts;
}

export interface CardsResponse {
  items: Notebox[];
  total: number;
}

export interface CardDetailResponse {
  notebox: Notebox;
  reviews: Review[];
}

export interface CreateCardResponse {
  notebox: Notebox;
  duplicate?: boolean;
  idempotentReplay?: boolean;
}

export interface ReviewResponse {
  review: Review;
  notebox: Notebox;
  duplicate?: boolean;
}

export interface GradeResponse {
  result: GradeResult | null;
  aiCallId: string | null;
  provider: 'live' | 'mock' | 'unavailable';
  model: string;
  error?: string;
}

export type CaptureMeta = {
  provider: 'live' | 'mock';
  model: string;
  latencyMs: number;
  cached: boolean;
  aiCallId: string | null;
};

export type CaptureEvent =
  | { type: 'status'; step: string; message: string }
  | { type: 'draft'; draft: CaptureDraft; meta: CaptureMeta }
  | { type: 'error'; code: string; message: string };

export interface CoachResponse {
  report: CoachReport | null;
}

export type MonitorData = MonitorSummary;
export type StatsData = UserStats;
