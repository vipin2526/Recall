export function getAiStatus(): { mode: 'live' | 'mock'; model: string } {
  const key = process.env.ANTHROPIC_API_KEY;
  const live = typeof key === 'string' && key.trim().length > 0;
  const model = process.env.AI_MODEL?.trim() || 'claude-haiku-4-5';
  return { mode: live ? 'live' : 'mock', model };
}
