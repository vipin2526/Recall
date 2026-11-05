import { z } from 'zod';

/**
 * Shared limits. These are enforced in two places: the JSON schema handed to the
 * model (so it aims for the right shape) and Zod (so bad output never reaches the DB).
 */
export const LIMITS = {
  keyPointsMin: 3,
  keyPointsMax: 5,
  keyPointMaxChars: 300,
  recallPromptMaxChars: 200,
  tagsMax: 3,
  tagMaxChars: 24,
  titleMaxChars: 120,
  feedbackMaxChars: 280,
  answerMaxChars: 4000,
  sourceTextMaxChars: 12_000,
  dailyFreeAiCalls: 20,
} as const;

export const RatingSchema = z.enum(['remembered', 'partial', 'forgot']);
export type Rating = z.infer<typeof RatingSchema>;

export const AiKindSchema = z.enum(['capture', 'grade', 'coach']);
export type AiKind = z.infer<typeof AiKindSchema>;

export const CaptureDraftSchema = z.object({
  title: z.string().min(3).max(LIMITS.titleMaxChars),
  key_points: z
    .array(z.string().min(3).max(LIMITS.keyPointMaxChars))
    .min(LIMITS.keyPointsMin)
    .max(LIMITS.keyPointsMax),
  recall_prompt: z.string().min(5).max(LIMITS.recallPromptMaxChars),
  tags: z.array(z.string().min(1).max(LIMITS.tagMaxChars)).max(LIMITS.tagsMax),
});
export type CaptureDraft = z.infer<typeof CaptureDraftSchema>;

function countSentences(text: string): number {
  return (text.match(/[.!?]+(?=\s|$)/g) ?? []).length;
}

export const GradeResultSchema = z
  .object({
    verdict: RatingSchema,
    missing_points: z.array(z.string().min(1).max(LIMITS.keyPointMaxChars)).max(5),
    feedback: z.string().min(1).max(LIMITS.feedbackMaxChars),
  })
  .refine((value) => countSentences(value.feedback) <= 2, {
    message: 'feedback must be at most 2 sentences',
    path: ['feedback'],
  });
export type GradeResult = z.infer<typeof GradeResultSchema>;

export const CoachSummarySchema = z.object({
  headline: z.string().min(3).max(80),
  lines: z.array(z.string().min(1).max(160)).length(3),
});
export type CoachSummary = z.infer<typeof CoachSummarySchema>;

export const CreateNoteboxSchema = z.object({
  title: z.string().min(1).max(LIMITS.titleMaxChars),
  key_points: z
    .array(z.string().min(1).max(LIMITS.keyPointMaxChars))
    .min(1)
    .max(LIMITS.keyPointsMax),
  recall_prompt: z.string().min(3).max(LIMITS.recallPromptMaxChars),
  tags: z.array(z.string().min(1).max(LIMITS.tagMaxChars)).max(LIMITS.tagsMax).default([]),
  source_url: z.string().url().max(2048).optional(),
  source_hash: z.string().max(128).optional(),
  idempotency_key: z.string().min(8).max(128).optional(),
});
export type CreateNoteboxInput = z.infer<typeof CreateNoteboxSchema>;

export const ReviewRequestSchema = z.object({
  notebox_id: z.string().min(1),
  rating: RatingSchema,
  verdict: RatingSchema.optional(),
  answer: z.string().max(LIMITS.answerMaxChars).optional(),
  feedback: z.string().max(LIMITS.feedbackMaxChars).optional(),
  ai_used: z.boolean().default(false),
  idempotency_key: z.string().min(8).max(128).optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const GradeRequestSchema = z.object({
  notebox_id: z.string().min(1),
  answer: z.string().min(1).max(LIMITS.answerMaxChars),
  idempotency_key: z.string().min(8).max(128).optional(),
});
export type GradeRequest = z.infer<typeof GradeRequestSchema>;

export const CaptureSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string().url().max(2048) }),
  z.object({
    kind: z.literal('text'),
    text: z.string().min(40).max(200_000),
    title: z.string().max(LIMITS.titleMaxChars).optional(),
  }),
]);
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;

export const CaptureRequestSchema = z.object({
  source: CaptureSourceSchema,
  idempotency_key: z.string().min(8).max(128).optional(),
});
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const FeedbackRequestSchema = z.object({
  surface: z.enum(['capture', 'grade', 'coach']),
  rating: z.union([z.literal(1), z.literal(-1)]),
  notebox_id: z.string().optional(),
  ai_call_id: z.string().optional(),
  idempotency_key: z.string().min(8).max(128).optional(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
