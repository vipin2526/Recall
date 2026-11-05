import type { ZodError } from 'zod';
import { GradeResultSchema, LIMITS } from '../schemas';
import type { GradeResult } from '../schemas';
import { GRADER_SYSTEM_PROMPT, GRADER_TOOL } from './prompts';
import { AiTimeoutError, getProvider } from './provider';
import type { ToolCallResult } from './provider';
import { getAiStatus } from './status';
import { estimateCostUsd, logAiCall } from './telemetry';

const MAX_TOKENS = 600;
const TIMEOUT_MS = 10_000;

export interface GradeOutcome {
  result: GradeResult | null;
  aiCallId: string | null;
  provider: 'live' | 'mock' | 'unavailable';
  model: string;
  error?: string;
}

export interface GraderInput {
  recallPrompt: string;
  keyPoints: string[];
  answer: string;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildGraderUserMessage(input: GraderInput): string {
  const keyPoints = input.keyPoints
    .map((point) => oneLine(point))
    .filter(Boolean)
    .map((point, index) => `${index + 1}. ${point}`)
    .join('\n');

  return [
    "Compare the learner's answer with the stored key points for this card. Return exactly one grade_answer tool call.",
    '',
    'RECALL PROMPT:',
    oneLine(input.recallPrompt),
    '',
    'KEY POINTS:',
    '<key_points>',
    keyPoints,
    '</key_points>',
    '',
    '<answer>',
    input.answer.trim().replace(/<\/answer>/gi, '</ answer>'),
    '</answer>',
  ].join('\n');
}

function issuesText(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || 'output'}: ${issue.message}`)
    .join('; ');
}

function clampFeedback(raw: string): string {
  let text = oneLine(raw);
  const terminators = [...text.matchAll(/[.!?]+(?=\s|$)/g)];
  if (terminators.length > 2) {
    const second = terminators[1];
    const end = (second.index ?? 0) + second[0].length;
    text = text.slice(0, end).trim();
  }
  return text.slice(0, LIMITS.feedbackMaxChars).trim();
}

function normalizeGrade(input: unknown): GradeResult | null {
  const parsed = GradeResultSchema.safeParse(input);
  if (!parsed.success) return null;

  const feedback = clampFeedback(parsed.data.feedback);
  if (feedback.length === 0) return null;

  const seen = new Set<string>();
  const missingPoints: string[] = [];
  for (const point of parsed.data.missing_points) {
    const cleaned = oneLine(point).slice(0, LIMITS.keyPointMaxChars);
    const signature = cleaned.toLowerCase();
    if (cleaned.length === 0 || seen.has(signature)) continue;
    seen.add(signature);
    missingPoints.push(cleaned);
    if (missingPoints.length >= 5) break;
  }

  return {
    verdict: parsed.data.verdict,
    missing_points: parsed.data.verdict === 'remembered' ? [] : missingPoints,
    feedback,
  };
}

function failure(message: string, model: string): GradeOutcome {
  return { result: null, aiCallId: null, provider: 'unavailable', model, error: message };
}

export async function gradeAnswer(input: {
  userId: string;
  recallPrompt: string;
  keyPoints: string[];
  answer: string;
}): Promise<GradeOutcome> {
  const status = getAiStatus();
  const providerName = status.mode === 'live' ? 'anthropic' : 'mock';

  const keyPoints = input.keyPoints.map(oneLine).filter(Boolean);
  if (keyPoints.length === 0) {
    return failure('This card has no key points to grade. Grade it yourself.', status.model);
  }

  const baseUser = buildGraderUserMessage({
    recallPrompt: input.recallPrompt,
    keyPoints,
    answer: input.answer,
  });

  let validationError = 'the previous output did not match the schema';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userMessage =
      attempt === 0
        ? baseUser
        : `${baseUser}\n\nYour previous grade_answer call was rejected by validation: ${validationError}. Return a corrected grade_answer call.`;

    let call: ToolCallResult;
    const attemptStartedAt = Date.now();
    try {
      call = await getProvider().callTool({
        kind: 'grade',
        system: GRADER_SYSTEM_PROMPT,
        user: userMessage,
        tool: GRADER_TOOL,
        maxTokens: MAX_TOKENS,
        temperature: 0,
        timeoutMs: TIMEOUT_MS,
      });
    } catch (err) {
      logAiCall({
        userId: input.userId,
        kind: 'grade',
        model: status.model,
        provider: providerName,
        latencyMs: Date.now() - attemptStartedAt,
        ok: false,
        validationOk: false,
        error: err instanceof AiTimeoutError ? 'timeout' : 'provider_error',
      });
      const message =
        err instanceof AiTimeoutError
          ? 'AI grading took too long. Grade this card yourself.'
          : 'AI grading is unavailable right now. Grade this card yourself.';
      return failure(message, status.model);
    }

    const costUsd = estimateCostUsd(call.model, call.inputTokens, call.outputTokens);
    const normalized = normalizeGrade(call.input);

    if (normalized) {
      const aiCallId = logAiCall({
        userId: input.userId,
        kind: 'grade',
        model: call.model,
        provider: call.provider,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        latencyMs: call.latencyMs,
        costUsd,
        ok: true,
        validationOk: true,
      });
      return {
        result: normalized,
        aiCallId,
        provider: call.provider === 'anthropic' ? 'live' : 'mock',
        model: call.model,
      };
    }

    const parsed = GradeResultSchema.safeParse(call.input);
    validationError = parsed.success ? 'the feedback was empty after cleanup' : issuesText(parsed.error);

    logAiCall({
      userId: input.userId,
      kind: 'grade',
      model: call.model,
      provider: call.provider,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.latencyMs,
      costUsd,
      ok: true,
      validationOk: false,
      error: 'validation_failed',
    });
  }

  return failure('AI grading failed validation. Grade this card yourself.', status.model);
}
