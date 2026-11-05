import Anthropic, { APIConnectionTimeoutError, APIUserAbortError } from '@anthropic-ai/sdk';
import { pluralize } from '../client/format';
import { getAiStatus } from './status';

const DEFAULT_TIMEOUT_MS = 10_000;

export class AiTimeoutError extends Error {
  constructor(message = 'The AI took too long to respond.') {
    super(message);
    this.name = 'AiTimeoutError';
  }
}

export class AiUnavailableError extends Error {
  constructor(message = 'The AI is unavailable right now.') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export interface ToolCallRequest {
  kind: 'capture' | 'grade' | 'coach';
  system: string;
  user: string;
  tool: { name: string; description: string; inputSchema: Record<string, unknown> };
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
}

export interface ToolCallResult {
  input: unknown;
  model: string;
  provider: 'anthropic' | 'mock';
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface ToolProvider {
  callTool(req: ToolCallRequest): Promise<ToolCallResult>;
}

function isTimeoutLike(err: unknown): boolean {
  if (err instanceof APIConnectionTimeoutError || err instanceof APIUserAbortError) return true;
  if (err instanceof Error) {
    return err.name === 'TimeoutError' || err.name === 'AbortError' || /aborted|timeout/i.test(err.message);
  }
  return false;
}

const anthropicProvider: ToolProvider = {
  async callTool(req) {
    const { model } = getAiStatus();
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    if (!apiKey.trim()) throw new AiUnavailableError('No AI API key is configured.');

    const client = new Anthropic({
      apiKey,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
      maxRetries: 0,
    });

    const system: Anthropic.Messages.TextBlockParam[] = [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
    ];
    const tools: Anthropic.Messages.Tool[] = [
      {
        name: req.tool.name,
        description: req.tool.description,
        input_schema: req.tool.inputSchema as Anthropic.Messages.Tool.InputSchema,
      },
    ];

    const startedAt = Date.now();
    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          system,
          messages: [{ role: 'user', content: req.user }],
          tools,
          tool_choice: { type: 'tool', name: req.tool.name },
        },
        { signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS) },
      );
    } catch (err) {
      if (isTimeoutLike(err)) throw new AiTimeoutError();
      throw new AiUnavailableError();
    }

    const latencyMs = Date.now() - startedAt;
    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) throw new AiUnavailableError('The AI returned an incomplete response.');

    return {
      input: toolUse.input,
      model: response.model || model,
      provider: 'anthropic',
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      latencyMs,
    };
  },
};

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'another', 'became', 'because', 'become',
  'been', 'before', 'being', 'between', 'both', 'call', 'called', 'change', 'changed', 'could',
  'does', 'doing', 'down', 'during', 'each', 'from', 'further', 'good', 'have', 'having', 'help',
  'helped', 'here', 'into', 'itself', 'just', 'know', 'known', 'large', 'less', 'made', 'make',
  'makes', 'making', 'many', 'more', 'most', 'much', 'must', 'never', 'new', 'often', 'old', 'only',
  'other', 'over', 'same', 'should', 'small', 'some', 'such', 'than', 'that', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until', 'used', 'using',
  'usually', 'very', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would',
  'your', 'yours',
]);

function toWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -1);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function contentTokens(value: string): string[] {
  return toWords(value)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map(stem);
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function truncateAt(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function clampText(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trim();
}

function cleanSentence(value: string): string {
  return stripMarkup(value)
    .replace(/^(?:[-*\u2022]|\d+[.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDocument(user: string): string {
  const match = user.match(/<document>([\s\S]*?)<\/document>/i);
  return (match?.[1] ?? user).trim();
}

function titledFromText(text: string, hint: string | undefined): string {
  const titleTag = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const heading = text.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1];
  const markdown = text.match(/^\s*#{1,3}\s+(.+)$/m)?.[1];
  const cleanedHint =
    hint && hint.trim().length >= 3 && !/^untitled(?:\s+source)?$/i.test(hint.trim())
      ? hint
      : undefined;

  const candidates = [cleanedHint, titleTag, heading, markdown].filter(
    (value): value is string => typeof value === 'string',
  );
  for (const candidate of candidates) {
    const title = clampText(stripMarkup(candidate), 120);
    if (title.length >= 3) return title;
  }

  const firstSentence = sentencesOf(stripMarkup(text))[0] ?? '';
  return titleFromSentence(firstSentence);
}

function titleFromSentence(sentence: string): string {
  const cleaned = clampText(sentence.replace(/[.!?]+$/, ''), 120);
  if (cleaned.length < 3) return 'Study note';

  const clause = cleaned.split(
    /[;:]\s*|,\s+(?:and|but|which|while|so|because)\b|\s+(?:so that|because|which|while)\b/i,
  )[0];
  const base = clause.length >= 12 ? clause : cleaned;
  const picked: string[] = [];
  for (const word of base.split(/\s+/)) {
    const next = [...picked, word].join(' ');
    if (next.length > 72 && picked.length > 0) break;
    picked.push(word);
  }
  while (
    picked.length > 3 &&
    /^(?:so|that|and|but|or|because|which|when|while|to|of|for|in|on|with|as|is|are|was|were|the|a|an|each)$/i.test(
      picked[picked.length - 1],
    )
  ) {
    picked.pop();
  }
  const title = picked.join(' ').replace(/[,:;.-]+$/, '');
  if (title.length < 3) return 'Study note';
  return `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
}

function keyPointsFrom(text: string): string[] {
  const points: string[] = [];
  const seen = new Set<string>();

  const add = (candidate: string) => {
    const point = clampText(cleanSentence(candidate), 300);
    if (point.length < 3) return false;
    const signature = point.toLowerCase();
    if (seen.has(signature)) return false;
    seen.add(signature);
    if (points.length < 5) {
      points.push(point);
      return true;
    }
    return false;
  };

  const sentences = sentencesOf(stripMarkup(text))
    .map((sentence) => sentence.replace(/[.!?]+$/, '.'))
    .filter((sentence) => clampText(sentence, 300).length >= 3);

  if (sentences.length <= 5) {
    for (const sentence of sentences) add(sentence);
  } else {
    const last = sentences.length - 1;
    const picks = [0, Math.round(last * 0.25), Math.round(last * 0.5), Math.round(last * 0.75), last];
    for (const index of picks) add(sentences[index]);
  }

  if (points.length < 3) {
    const chunks: string[] = [];
    let current = '';
    for (const word of stripMarkup(text).split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > 150 && current) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
    for (const chunk of chunks) {
      if (points.length >= 3) break;
      add(chunk.endsWith('.') ? chunk : `${chunk}.`);
    }
  }

  while (points.length < 3) {
    points.push(`Key idea ${points.length + 1}: the source was too short to extract further detail.`);
  }

  return points.slice(0, 5);
}

function tagsFrom(text: string, title: string): string[] {
  const counts = new Map<string, number>();
  for (const word of toWords(`${title} ${text}`)) {
    if (word.length < 5 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word.slice(0, 24));

  const tags: string[] = [];
  for (const tag of ranked) {
    if (tags.length >= 3) break;
    if (!tags.includes(tag)) tags.push(tag);
  }
  for (const filler of ['study', 'notes', 'recall']) {
    if (tags.length >= 3) break;
    if (!tags.includes(filler)) tags.push(filler);
  }
  return tags.slice(0, 3);
}

function mockCapture(user: string): Record<string, unknown> {
  const rawDocument = extractDocument(user);
  const text = stripMarkup(rawDocument);
  const titleHint = user.match(/^SOURCE TITLE:\s*(.+)$/m)?.[1];
  const title = titledFromText(rawDocument, titleHint);
  const keyPoints = keyPointsFrom(rawDocument);
  const shortTitle = truncateAt(title, 80);
  const recallPrompt = clampText(
    `Without looking, rebuild the key ideas of "${shortTitle}" in your own words.`,
    200,
  );

  return {
    title,
    key_points: keyPoints,
    recall_prompt:
      recallPrompt.length >= 5
        ? recallPrompt
        : 'Without looking, rebuild the key ideas of this source in your own words.',
    tags: tagsFrom(text, title),
  };
}

function mockGrade(user: string): Record<string, unknown> {
  const pointsBlock = user.match(/<key_points>([\s\S]*?)<\/key_points>/i)?.[1] ?? '';
  const answer = user.match(/<answer>([\s\S]*?)<\/answer>/i)?.[1] ?? '';

  const points = pointsBlock
    .split('\n')
    .map((line) => cleanSentence(line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '')))
    .filter(Boolean)
    .slice(0, 12);

  const answerTokens = new Set(contentTokens(answer));
  const coverages = points.map((point) => {
    const tokens = contentTokens(point);
    if (tokens.length === 0) return 1;
    const hits = tokens.filter((token) => answerTokens.has(token)).length;
    return hits / tokens.length;
  });

  const average =
    coverages.length > 0
      ? coverages.reduce((sum, value) => sum + value, 0) / coverages.length
      : 0;
  const weakest = coverages.length > 0 ? Math.min(...coverages) : 0;
  const verdict =
    average >= 0.55 && weakest >= 0.3 ? 'remembered' : average <= 0.15 ? 'forgot' : 'partial';

  const missing = points
    .filter((_point, index) => coverages[index] < 0.45)
    .map((point) => clampText(point.replace(/[.!?;:]+/g, ' '), 120))
    .filter((point) => point.length > 0)
    .slice(0, 5);

  const answered = Math.max(0, points.length - missing.length);
  const firstMissing = missing[0];
  let feedback: string;
  if (verdict === 'remembered') {
    feedback = `You covered all ${pluralize(points.length, 'key point')}; nothing important is missing. The next interval is already set.`;
  } else if (verdict === 'partial') {
    feedback = firstMissing
      ? `You covered ${answered} of ${pluralize(points.length, 'key point')}. Review this before the next session: ${firstMissing}.`
      : 'You covered part of the card, but some details were unclear. Check the key points once more before the next review.';
  } else {
    feedback = firstMissing
      ? `Your answer overlaps with little of the card. Start with this point: ${firstMissing}.`
      : 'Your answer does not overlap with the stored key points. Review the key points and try again from memory.';
  }

  return {
    verdict,
    missing_points: verdict === 'remembered' ? [] : missing,
    feedback: clampText(feedback, 280),
  };
}

function statsNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function statsFromCoachMessage(user: string): Record<string, unknown> {
  for (const match of user.matchAll(/<stats>([\s\S]*?)<\/stats>/gi)) {
    try {
      const parsed: unknown = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next block; instructions may also mention the tag name.
    }
  }
  return {};
}

function mockCoach(user: string): Record<string, unknown> {
  const stats = statsFromCoachMessage(user);

  const reviews = Math.round(statsNumber(stats.reviews));
  const accuracy = Math.min(1, Math.max(0, statsNumber(stats.accuracy)));
  const activeDays = Math.round(statsNumber(stats.activeDays));
  const streakDays = Math.round(statsNumber(stats.streakDays));
  const cardsCreated = Math.round(statsNumber(stats.cardsCreated));
  const dueCount = Math.round(statsNumber(stats.dueCount));
  const percent = Math.round(accuracy * 100);

  const hardest = Array.isArray(stats.hardest)
    ? (stats.hardest as Array<Record<string, unknown>>).find(
        (entry) => entry && typeof entry.title === 'string',
      )
    : undefined;

  const headline = clampText(
    reviews > 0
      ? `A steady week: ${reviews} review${reviews === 1 ? '' : 's'} at ${percent}% recall`
      : 'A quiet week: your cards are waiting',
    80,
  );

  const lines = [
    reviews > 0
      ? `You reviewed ${reviews} card${reviews === 1 ? '' : 's'} on ${activeDays} of 7 days and recalled ${percent}% of them.`
      : 'You did not review any cards this week, and that is fine.',
    reviews > 0
      ? `Your current streak is ${streakDays} day${streakDays === 1 ? '' : 's'} and you added ${cardsCreated} new card${cardsCreated === 1 ? '' : 's'}.`
      : 'No streak is running yet, so this is a clean start.',
    hardest
      ? `Trickiest card: ${String(hardest.title)} with ${Math.round(statsNumber(hardest.misses))} miss${Math.round(statsNumber(hardest.misses)) === 1 ? '' : 'es'}; give it an extra pass this week.`
      : `You have ${dueCount} card${dueCount === 1 ? '' : 's'} due now; one short session keeps the habit going.`,
  ].map((line) => clampText(line, 160));

  return { headline, lines };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function mockDelay(req: ToolCallRequest): number {
  let sum = req.tool.name.length;
  for (let index = 0; index < req.user.length; index += 1) {
    sum = (sum + req.user.charCodeAt(index)) % 251;
  }
  return 150 + sum;
}

function mockInput(req: ToolCallRequest): unknown {
  const name = req.tool.name;
  if (name === 'save_notebox' || req.kind === 'capture') return mockCapture(req.user);
  if (name === 'grade_answer' || req.kind === 'grade') return mockGrade(req.user);
  if (name === 'save_coach_summary' || req.kind === 'coach') return mockCoach(req.user);
  throw new AiUnavailableError(`The mock provider does not support tool "${name}".`);
}

const mockProvider: ToolProvider = {
  async callTool(req) {
    const delay = mockDelay(req);
    await new Promise((resolve) => setTimeout(resolve, delay));
    const input = mockInput(req);
    return {
      input,
      model: 'mock-haiku',
      provider: 'mock',
      inputTokens: estimateTokens(req.system) + estimateTokens(req.user),
      outputTokens: estimateTokens(JSON.stringify(input)),
      latencyMs: delay,
    };
  },
};

export function getProvider(): ToolProvider {
  return getAiStatus().mode === 'live' ? anthropicProvider : mockProvider;
}
