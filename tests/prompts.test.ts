import { describe, expect, it } from 'vitest';
import {
  CAPTURE_SYSTEM_PROMPT,
  CAPTURE_TOOL,
  COACH_SYSTEM_PROMPT,
  COACH_TOOL,
  GRADER_SYSTEM_PROMPT,
  GRADER_TOOL,
} from '@/lib/ai/prompts';
import type { ToolDefinition } from '@/lib/ai/prompts';

function propertyNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  return Object.keys(properties as Record<string, unknown>).sort();
}

function requiredNames(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  if (!Array.isArray(required)) return [];
  return required.filter((entry): entry is string => typeof entry === 'string');
}

/** Accepts either "Example 1 / Example 2" prose or a numbered example list. */
function exampleMarkerCount(prompt: string): number {
  const named = prompt.match(/example\s*\d+/gi)?.length ?? 0;
  const numbered = prompt.match(/^\s*\d+[.)]\s/gm)?.length ?? 0;
  return Math.max(named, numbered);
}

function assertToolShape(tool: ToolDefinition, name: string, expectedKeys: string[]): void {
  expect(tool.name).toBe(name);
  expect(tool.description.length).toBeGreaterThan(20);
  expect(propertyNames(tool.inputSchema)).toEqual([...expectedKeys].sort());
  for (const key of expectedKeys) {
    expect(requiredNames(tool.inputSchema)).toContain(key);
  }
}

describe('tool definitions', () => {
  it('defines save_notebox with the capture draft schema', () => {
    assertToolShape(CAPTURE_TOOL, 'save_notebox', [
      'title',
      'key_points',
      'recall_prompt',
      'tags',
    ]);
    expect(CAPTURE_TOOL.inputSchema.type).toBe('object');
  });

  it('defines grade_answer with the grade result schema', () => {
    assertToolShape(GRADER_TOOL, 'grade_answer', [
      'verdict',
      'missing_points',
      'feedback',
    ]);
    const properties = GRADER_TOOL.inputSchema.properties as Record<string, unknown>;
    const verdict = properties.verdict as Record<string, unknown>;
    expect(verdict.enum).toEqual(['remembered', 'partial', 'forgot']);
  });

  it('defines save_coach_summary with headline and three lines', () => {
    assertToolShape(COACH_TOOL, 'save_coach_summary', ['headline', 'lines']);
    const properties = COACH_TOOL.inputSchema.properties as Record<string, unknown>;
    const lines = properties.lines as Record<string, unknown>;
    expect(lines.minItems).toBe(3);
    expect(lines.maxItems).toBe(3);
  });
});

describe('capture prompt', () => {
  it('wraps untrusted documents in explicit delimiters', () => {
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/<document>/i);
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/<\/document>/i);
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/untrusted/i);
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/ignore\s+(every|all|any)\s+instruction/i);
  });

  it('names its tool and carries at least two worked examples', () => {
    expect(CAPTURE_SYSTEM_PROMPT).toContain('save_notebox');
    expect(exampleMarkerCount(CAPTURE_SYSTEM_PROMPT)).toBeGreaterThanOrEqual(2);
  });

  it('states the key-point and prompt constraints', () => {
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/3-5\s+key points/i);
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/200\s+characters/i);
  });
});

describe('grader prompt', () => {
  it('grounds grading in the stored key points', () => {
    expect(GRADER_SYSTEM_PROMPT).toMatch(/key points/i);
    expect(GRADER_SYSTEM_PROMPT).toMatch(/compare only against the stored key points/i);
  });

  it('requires short two-sentence feedback', () => {
    expect(GRADER_SYSTEM_PROMPT).toMatch(/(two|2)\s+sentences/i);
    expect(GRADER_SYSTEM_PROMPT).toMatch(/280\s+characters/i);
  });

  it('names its tool, defines verdicts, and carries examples', () => {
    expect(GRADER_SYSTEM_PROMPT).toContain('grade_answer');
    for (const verdict of ['remembered', 'partial', 'forgot']) {
      expect(GRADER_SYSTEM_PROMPT.toLowerCase()).toContain(verdict);
    }
    expect(exampleMarkerCount(GRADER_SYSTEM_PROMPT)).toBeGreaterThanOrEqual(2);
  });

  it('treats the student answer as untrusted input', () => {
    expect(GRADER_SYSTEM_PROMPT).toMatch(/untrusted learner input/i);
  });
});

describe('coach prompt', () => {
  it('says numbers must come from the supplied stats', () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/stats/i);
    expect(COACH_SYSTEM_PROMPT).toMatch(/numbers/i);
    expect(COACH_SYSTEM_PROMPT).toMatch(/never invent data/i);
  });

  it('names its tool and carries at least two worked examples', () => {
    expect(COACH_SYSTEM_PROMPT).toContain('save_coach_summary');
    expect(exampleMarkerCount(COACH_SYSTEM_PROMPT)).toBeGreaterThanOrEqual(2);
  });

  it('asks for exactly three short lines', () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/exactly\s+3\s+short\s+sentences/i);
  });
});
