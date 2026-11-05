import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  LADDER_DAYS,
  MAX_STEP,
  applyRating,
  intervalDaysForStep,
  isDue,
} from '@/lib/scheduler';

const NOW = 1_700_000_000_000;

describe('ladder constants', () => {
  it('exposes the fixed ladder and cap', () => {
    expect([...LADDER_DAYS]).toEqual([1, 3, 7, 21, 100, 365]);
    expect(MAX_STEP).toBe(6);
    expect(DAY_MS).toBe(86_400_000);
  });

  it('maps steps to intervals and clamps out-of-range steps', () => {
    expect(intervalDaysForStep(0)).toBe(0);
    expect(intervalDaysForStep(-3)).toBe(0);
    expect(intervalDaysForStep(1)).toBe(1);
    expect(intervalDaysForStep(2)).toBe(3);
    expect(intervalDaysForStep(3)).toBe(7);
    expect(intervalDaysForStep(4)).toBe(21);
    expect(intervalDaysForStep(5)).toBe(100);
    expect(intervalDaysForStep(6)).toBe(365);
    expect(intervalDaysForStep(99)).toBe(365);
  });
});

describe('applyRating progression', () => {
  it('walks the full ladder 1 -> 3 -> 7 -> 21 -> 100 -> 365', () => {
    const expected = [
      { step: 1, intervalDays: 1 },
      { step: 2, intervalDays: 3 },
      { step: 3, intervalDays: 7 },
      { step: 4, intervalDays: 21 },
      { step: 5, intervalDays: 100 },
      { step: 6, intervalDays: 365 },
    ];

    let step = 0;
    for (const [index, want] of expected.entries()) {
      const at = NOW + index * DAY_MS;
      const result = applyRating({ step, rating: 'remembered', now: at });
      expect(result).toMatchObject(want);
      expect(result.dueAt).toBe(at + want.intervalDays * DAY_MS);
      expect(result.countedAs).toBeNull();
      step = result.step;
    }
    expect(step).toBe(MAX_STEP);
  });

  it('stays capped at MAX_STEP with the 365-day interval', () => {
    const result = applyRating({ step: MAX_STEP, rating: 'remembered', now: NOW });
    expect(result.step).toBe(MAX_STEP);
    expect(result.intervalDays).toBe(365);
    expect(result.dueAt).toBe(NOW + 365 * DAY_MS);
  });

  it('caps a step that arrives above MAX_STEP', () => {
    const result = applyRating({ step: 42, rating: 'remembered', now: NOW });
    expect(result.step).toBe(MAX_STEP);
    expect(result.intervalDays).toBe(365);
  });

  it('resets a forgotten card to step 0 with a 1-day interval', () => {
    const result = applyRating({ step: 4, rating: 'forgot', now: NOW });
    expect(result.step).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.dueAt).toBe(NOW + DAY_MS);
    expect(result.countedAs).toBeNull();
  });

  it('treats a new card answered remembered as step 1', () => {
    const result = applyRating({ step: 0, rating: 'remembered', now: NOW });
    expect(result.step).toBe(1);
    expect(result.intervalDays).toBe(1);
  });
});

describe('partial handling', () => {
  it('counts partial as forgot by default', () => {
    const result = applyRating({ step: 3, rating: 'partial', now: NOW });
    expect(result.step).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.dueAt).toBe(NOW + DAY_MS);
    expect(result.countedAs).toBe('forgot');
  });

  it('counts partial as remembered when configured', () => {
    const result = applyRating({
      step: 3,
      rating: 'partial',
      partialCountsAs: 'remembered',
      now: NOW,
    });
    expect(result.step).toBe(4);
    expect(result.intervalDays).toBe(21);
    expect(result.dueAt).toBe(NOW + 21 * DAY_MS);
    expect(result.countedAs).toBe('remembered');
  });

  it('still caps partial-as-remembered at MAX_STEP', () => {
    const result = applyRating({
      step: MAX_STEP,
      rating: 'partial',
      partialCountsAs: 'remembered',
      now: NOW,
    });
    expect(result.step).toBe(MAX_STEP);
    expect(result.intervalDays).toBe(365);
    expect(result.countedAs).toBe('remembered');
  });
});

describe('dueAt arithmetic with a fixed now', () => {
  it('uses the injected now, not the wall clock', () => {
    const remembered = applyRating({ step: 2, rating: 'remembered', now: NOW });
    expect(remembered.dueAt).toBe(NOW + 7 * DAY_MS);

    const forgot = applyRating({ step: 5, rating: 'forgot', now: NOW });
    expect(forgot.dueAt).toBe(NOW + DAY_MS);
  });
});

describe('isDue', () => {
  it('is due at or after the due timestamp', () => {
    expect(isDue(NOW, NOW)).toBe(true);
    expect(isDue(NOW - 1, NOW)).toBe(true);
    expect(isDue(NOW + 1, NOW)).toBe(false);
  });

  it('defaults now to the current clock', () => {
    const now = Date.now();
    expect(isDue(now - 1_000)).toBe(true);
    expect(isDue(now + 60_000)).toBe(false);
  });
});
