import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * These tests exercise the deterministic offline provider end to end. The key
 * must be absent before the AI modules are imported, so every import below is
 * dynamic and happens after the environment is prepared.
 */

const DB_FILE = path.join(process.cwd(), 'data', `test-mock-${process.pid}-${Date.now()}.db`);
const USER_ID = 'usr_mock_test';

let captureOnce: (typeof import('@/lib/ai/capture'))['captureOnce'];
let gradeAnswer: (typeof import('@/lib/ai/grader'))['gradeAnswer'];
let generateCoachReport: (typeof import('@/lib/ai/coach'))['generateCoachReport'];
let closeDb: (typeof import('@/lib/db/connection'))['closeDb'];

function removeDbFiles(base: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${base}${suffix}`, { force: true });
  }
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.DB_FILE = DB_FILE;
  removeDbFiles(DB_FILE);

  const { getDb } = await import('@/lib/db/connection');
  getDb()
    .prepare(
      `INSERT INTO users (id, created_at, plan, daily_ai_limit, partial_counts_as, ai_grading)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(USER_ID, Date.now(), 'free', 100_000, 'forgot', 1);

  ({ captureOnce } = await import('@/lib/ai/capture'));
  ({ gradeAnswer } = await import('@/lib/ai/grader'));
  ({ generateCoachReport } = await import('@/lib/ai/coach'));
  ({ closeDb } = await import('@/lib/db/connection'));
});

afterAll(() => {
  try {
    closeDb?.();
  } catch {
    // The DB may already be closed; file cleanup is best effort on Windows.
  }
  removeDbFiles(DB_FILE);
});

describe('offline capture mock', () => {
  it('returns a schema-valid draft for a pasted note', async () => {
    const draft = await captureOnce({
      userId: USER_ID,
      source: {
        kind: 'text',
        title: 'Spaced repetition basics',
        text: [
          'Spaced repetition schedules reviews at growing intervals.',
          'Retrieving an idea strengthens memory more than rereading it.',
          'A forgotten card resets to the first interval.',
          'A partial answer follows the learner policy.',
          'Short daily sessions beat long cramming sessions.',
        ].join(' '),
      },
    });

    expect(draft.title.length).toBeGreaterThanOrEqual(3);
    expect(draft.title.length).toBeLessThanOrEqual(120);
    expect(draft.key_points.length).toBeGreaterThanOrEqual(3);
    expect(draft.key_points.length).toBeLessThanOrEqual(5);
    expect(draft.recall_prompt.length).toBeGreaterThanOrEqual(5);
    expect(draft.recall_prompt.length).toBeLessThanOrEqual(200);
    expect(draft.tags.length).toBeLessThanOrEqual(3);

    const { CaptureDraftSchema } = await import('@/lib/schemas');
    expect(CaptureDraftSchema.safeParse(draft).success).toBe(true);
  });
});

describe('offline grader mock', () => {
  it('returns a valid GradeResult and marks a complete answer remembered', async () => {
    const outcome = await gradeAnswer({
      userId: USER_ID,
      recallPrompt: 'What do mitochondria do?',
      keyPoints: ['Mitochondria produce ATP', 'Mitochondria have a double membrane'],
      answer: 'Mitochondria produce ATP and they have a double membrane.',
    });

    expect(outcome.provider).toBe('mock');
    expect(outcome.result).not.toBeNull();
    const result = outcome.result;
    if (!result) return;

    const { GradeResultSchema } = await import('@/lib/schemas');
    expect(GradeResultSchema.safeParse(result).success).toBe(true);
    expect(result.verdict).toBe('remembered');
    expect(result.missing_points).toEqual([]);
    expect(result.feedback.length).toBeLessThanOrEqual(280);
  });

  it('marks a blank, off-topic answer as forgot', async () => {
    const outcome = await gradeAnswer({
      userId: USER_ID,
      recallPrompt: 'What do mitochondria do?',
      keyPoints: ['Mitochondria produce ATP', 'Mitochondria have a double membrane'],
      answer: 'Bananas are yellow and grow in tropical places.',
    });

    expect(outcome.provider).toBe('mock');
    expect(outcome.result?.verdict).toBe('forgot');
  });
});

describe('offline coach mock', () => {
  it('produces a schema-valid weekly summary', async () => {
    const report = await generateCoachReport(USER_ID);
    const { CoachSummarySchema } = await import('@/lib/schemas');
    const parsed = CoachSummarySchema.safeParse(report.summary);

    expect(parsed.success).toBe(true);
    expect(report.summary.lines).toHaveLength(3);
    expect(report.summary.headline.length).toBeLessThanOrEqual(80);
  });
});
