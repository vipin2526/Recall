const DAY_MS = 86_400_000;

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const weekdayDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatLongDate(ts: number | Date): string {
  return longDate.format(ts);
}

export function formatWeekdayDate(ts: number | Date): string {
  return weekdayDate.format(ts);
}

export function formatShortDate(ts: number): string {
  return shortDate.format(ts);
}

export function formatMonthYear(ts: number): string {
  return monthYear.format(ts);
}

export function formatDateTime(ts: number): string {
  return dateTime.format(ts);
}

/** "Due now", "Due in 3 days", "Overdue 2 days". */
export function formatDue(dueAt: number, now: number = Date.now()): string {
  const diff = dueAt - now;
  if (diff <= 0) {
    const overdueDays = Math.floor(-diff / DAY_MS);
    return overdueDays >= 1 ? `Overdue ${pluralize(overdueDays, 'day')}` : 'Due now';
  }
  const inDays = Math.ceil(diff / DAY_MS);
  return `Due in ${pluralize(inDays, 'day')}`;
}

/** "1 day", "3 days", "3 mo", "1 yr" — matches the scheduler's display scale. */
export function formatInterval(intervalDays: number): string {
  if (intervalDays <= 0) return 'now';
  if (intervalDays === 1) return '1 day';
  if (intervalDays < 30) return `${intervalDays} days`;
  if (intervalDays < 365) return `${Math.round(intervalDays / 30)} mo`;
  return `${Math.round(intervalDays / 365)} yr`;
}

export function formatStep(step: number): string {
  return step <= 0 ? 'New' : `Step ${step}`;
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatShortDate(ts);
}

export function formatAnswerCount(length: number, max: number): string {
  return `${length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`;
}

export function sourceHost(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
