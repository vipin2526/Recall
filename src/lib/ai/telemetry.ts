import { getDb } from '../db/connection';
import { newId } from '../ids';
import type { AiKind } from '../schemas';

export interface AiCallLogInput {
  userId: string | null;
  kind: AiKind;
  model: string;
  provider: 'anthropic' | 'mock';
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  ok?: boolean;
  validationOk?: boolean;
  cached?: boolean;
  error?: string | null;
}

export function logAiCall(input: AiCallLogInput): string {
  const id = newId('aic');
  try {
    getDb()
      .prepare(
        `INSERT INTO ai_calls (
           id, user_id, kind, model, provider, input_tokens, output_tokens,
           latency_ms, cost_usd, ok, validation_ok, cached, error, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.kind,
        input.model,
        input.provider,
        Math.max(0, Math.round(input.inputTokens ?? 0)),
        Math.max(0, Math.round(input.outputTokens ?? 0)),
        Math.max(0, Math.round(input.latencyMs ?? 0)),
        Math.max(0, input.costUsd ?? 0),
        input.ok === false ? 0 : 1,
        input.validationOk === false ? 0 : 1,
        input.cached ? 1 : 0,
        input.error ? input.error.slice(0, 500) : null,
        Date.now(),
      );
  } catch (err) {
    // Telemetry must never break a request that already succeeded.
    console.error('[ai] failed to log call', err);
  }
  return id;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const name = model.toLowerCase();
  if (name.includes('mock')) return 0;

  let inputRate = 1;
  let outputRate = 5;
  if (name.includes('opus')) {
    inputRate = 15;
    outputRate = 75;
  } else if (name.includes('sonnet')) {
    inputRate = 3;
    outputRate = 15;
  }

  const cost =
    (Math.max(0, inputTokens) / 1_000_000) * inputRate +
    (Math.max(0, outputTokens) / 1_000_000) * outputRate;
  return Number(cost.toFixed(6));
}
