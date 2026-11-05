import type { Rating } from './schemas';

/**
 * The ladder is plain code. AI never decides the schedule; it can only suggest a
 * rating, and the user can override. Intervals: 1, 3, 7, 21, 100, 365 days.
 */
export const LADDER_DAYS = [1, 3, 7, 21, 100, 365] as const;
export const MAX_STEP = LADDER_DAYS.length;
export const DAY_MS = 86_400_000;

export type PartialBehavior = 'forgot' | 'remembered';

export interface ScheduleResult {
  step: number;
  intervalDays: number;
  dueAt: number;
  /** How a 'partial' verdict was counted for scheduling. */
  countedAs: 'remembered' | 'forgot' | null;
}

/** Interval that follows a card at `step` (step 0 = new card, not yet scheduled). */
export function intervalDaysForStep(step: number): number {
  if (step <= 0) return 0;
  return LADDER_DAYS[Math.min(step, MAX_STEP) - 1];
}

export function applyRating(input: {
  step: number;
  rating: Rating;
  partialCountsAs?: PartialBehavior;
  now?: number;
}): ScheduleResult {
  const { step, rating, partialCountsAs = 'forgot', now = Date.now() } = input;

  let remembered: boolean;
  let countedAs: ScheduleResult['countedAs'] = null;
  if (rating === 'remembered') {
    remembered = true;
  } else if (rating === 'partial') {
    remembered = partialCountsAs === 'remembered';
    countedAs = partialCountsAs === 'remembered' ? 'remembered' : 'forgot';
  } else {
    remembered = false;
  }

  const nextStep = remembered ? Math.min(Math.max(step, 0) + 1, MAX_STEP) : 0;
  const intervalDays = remembered ? intervalDaysForStep(nextStep) : LADDER_DAYS[0];

  return {
    step: nextStep,
    intervalDays,
    dueAt: now + intervalDays * DAY_MS,
    countedAs,
  };
}

/** A card is due when it was never reviewed (dueAt = creation time) or its due time passed. */
export function isDue(dueAt: number, now: number = Date.now()): boolean {
  return dueAt <= now;
}

export function formatInterval(intervalDays: number): string {
  if (intervalDays <= 0) return 'now';
  if (intervalDays === 1) return '1 day';
  if (intervalDays < 30) return `${intervalDays} days`;
  if (intervalDays < 365) return `${Math.round(intervalDays / 30)} mo`;
  return `${Math.round(intervalDays / 365)} yr`;
}
