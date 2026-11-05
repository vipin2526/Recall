/**
 * Client-side limits mirror src/lib/schemas.ts LIMITS.
 *
 * The schemas module pulls in zod, so client code imports it with `import type`
 * only. These literals are the single client-side copy of the numeric limits and
 * must stay in sync with the server contract.
 */
export const CLIENT_LIMITS = {
  keyPointsMin: 3,
  keyPointsMax: 5,
  keyPointMaxChars: 300,
  recallPromptMaxChars: 200,
  tagsMax: 3,
  tagMaxChars: 24,
  titleMaxChars: 120,
  answerMaxChars: 4000,
  sourceTextMaxChars: 12_000,
} as const;

/** Plain-code ladder, mirrored from src/lib/scheduler.ts for display only. */
export const LADDER_DAYS = [1, 3, 7, 21, 100, 365] as const;
