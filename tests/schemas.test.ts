import { describe, expect, it } from 'vitest';
import {
  CaptureDraftSchema,
  CaptureSourceSchema,
  CoachSummarySchema,
  CreateNoteboxSchema,
  GradeResultSchema,
  LIMITS,
  ReviewRequestSchema,
} from '@/lib/schemas';

const validDraft = {
  title: 'HTTP caching validators',
  key_points: [
    'An ETag identifies one specific version of a response.',
    'If-None-Match sends the stored validator back to the server.',
    'A 304 response tells the client to reuse its cached copy.',
  ],
  recall_prompt: 'Without looking, explain how an ETag avoids downloading an unchanged page.',
  tags: ['http', 'caching'],
};

describe('CaptureDraftSchema', () => {
  it('accepts a valid draft', () => {
    const parsed = CaptureDraftSchema.safeParse(validDraft);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.key_points).toHaveLength(3);
      expect(parsed.data.tags).toEqual(['http', 'caching']);
    }
  });

  it('accepts the boundaries of 3 and 5 key points', () => {
    expect(
      CaptureDraftSchema.safeParse({
        ...validDraft,
        key_points: validDraft.key_points.slice(0, 3),
      }).success,
    ).toBe(true);
    expect(
      CaptureDraftSchema.safeParse({
        ...validDraft,
        key_points: [...validDraft.key_points, 'A fourth point.', 'A fifth point.'],
      }).success,
    ).toBe(true);
  });

  it('rejects 2 and 6 key points', () => {
    expect(
      CaptureDraftSchema.safeParse({
        ...validDraft,
        key_points: validDraft.key_points.slice(0, 2),
      }).success,
    ).toBe(false);
    expect(
      CaptureDraftSchema.safeParse({
        ...validDraft,
        key_points: [
          ...validDraft.key_points,
          'A fourth point.',
          'A fifth point.',
          'A sixth point.',
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects an empty key point', () => {
    const result = CaptureDraftSchema.safeParse({
      ...validDraft,
      key_points: ['A real point.', '', 'Another real point.'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a recall prompt over 200 characters', () => {
    const result = CaptureDraftSchema.safeParse({
      ...validDraft,
      recall_prompt: 'x'.repeat(LIMITS.recallPromptMaxChars + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 3 tags', () => {
    const result = CaptureDraftSchema.safeParse({
      ...validDraft,
      tags: ['a', 'b', 'c', 'd'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a title over 120 characters', () => {
    const result = CaptureDraftSchema.safeParse({
      ...validDraft,
      title: 'x'.repeat(LIMITS.titleMaxChars + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe('GradeResultSchema', () => {
  it('accepts a valid two-sentence result', () => {
    const parsed = GradeResultSchema.safeParse({
      verdict: 'partial',
      missing_points: ['The double membrane'],
      feedback: 'You explained ATP production clearly. Also check the double membrane.',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a one-sentence result and an empty missing list', () => {
    expect(
      GradeResultSchema.safeParse({
        verdict: 'remembered',
        missing_points: [],
        feedback: 'You recalled every key point accurately.',
      }).success,
    ).toBe(true);
  });

  it('rejects three-sentence feedback', () => {
    const parsed = GradeResultSchema.safeParse({
      verdict: 'forgot',
      missing_points: [],
      feedback: 'One sentence. Two sentences. Three sentences.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid verdict', () => {
    const parsed = GradeResultSchema.safeParse({
      verdict: 'excellent',
      missing_points: [],
      feedback: 'Great work.',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects feedback over 280 characters', () => {
    const parsed = GradeResultSchema.safeParse({
      verdict: 'partial',
      missing_points: [],
      feedback: `${'a'.repeat(LIMITS.feedbackMaxChars)}.`,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('CreateNoteboxSchema', () => {
  it('allows 1 key point', () => {
    const parsed = CreateNoteboxSchema.safeParse({
      title: 'One fact',
      key_points: ['Only this point matters.'],
      recall_prompt: 'What is the one fact?',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.tags).toEqual([]);
  });

  it('allows 5 key points', () => {
    const parsed = CreateNoteboxSchema.safeParse({
      title: 'Five facts',
      key_points: ['One.', 'Two.', 'Three.', 'Four.', 'Five.'],
      recall_prompt: 'List the five facts.',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects 6 key points', () => {
    const parsed = CreateNoteboxSchema.safeParse({
      title: 'Too many',
      key_points: ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'],
      recall_prompt: 'List them.',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('auxiliary schemas', () => {
  it('validates capture sources as a discriminated union', () => {
    expect(
      CaptureSourceSchema.safeParse({ kind: 'url', url: 'https://example.com/article' }).success,
    ).toBe(true);
    expect(
      CaptureSourceSchema.safeParse({ kind: 'text', text: 'A'.repeat(60) }).success,
    ).toBe(true);
    expect(CaptureSourceSchema.safeParse({ kind: 'url', url: 'not a url' }).success).toBe(false);
  });

  it('accepts a valid coach summary and rejects a wrong line count', () => {
    expect(
      CoachSummarySchema.safeParse({
        headline: 'A solid week of reviews',
        lines: ['One line.', 'Two lines.', 'Three lines.'],
      }).success,
    ).toBe(true);
    expect(
      CoachSummarySchema.safeParse({
        headline: 'A solid week of reviews',
        lines: ['One line.', 'Two lines.'],
      }).success,
    ).toBe(false);
  });

  it('validates a review request and defaults ai_used to false', () => {
    const parsed = ReviewRequestSchema.safeParse({
      notebox_id: 'nb_1',
      rating: 'remembered',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ai_used).toBe(false);
  });
});

describe('LIMITS', () => {
  it('keeps the documented clamps internally consistent', () => {
    expect(LIMITS.keyPointsMin).toBe(3);
    expect(LIMITS.keyPointsMax).toBe(5);
    expect(LIMITS.keyPointsMin).toBeLessThan(LIMITS.keyPointsMax);
    expect(LIMITS.recallPromptMaxChars).toBe(200);
    expect(LIMITS.tagsMax).toBe(3);
    expect(LIMITS.titleMaxChars).toBe(120);
    expect(LIMITS.feedbackMaxChars).toBe(280);
    expect(LIMITS.answerMaxChars).toBeGreaterThan(LIMITS.keyPointMaxChars);
    expect(LIMITS.dailyFreeAiCalls).toBeGreaterThan(0);
  });
});
