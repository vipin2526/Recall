'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  IconArrowRight,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconFlame,
  IconPen,
  IconSun,
} from '@/components/icons';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SectionLabel,
  StatTile,
  StepBadge,
  TagChip,
  buttonStyles,
  cx,
} from '@/components/ui';
import { apiGet, errorMessage, isAbortError } from '@/lib/client/api';
import type { StatsData, TodayResponse } from '@/lib/client/api-types';
import { formatDue, formatWeekdayDate, greeting, pluralize } from '@/lib/client/format';
import type { Notebox } from '@/lib/db/types';

function DueRow({ card, index }: { card: Notebox; index: number }) {
  return (
    <Link
      href={`/review?card=${encodeURIComponent(card.id)}`}
      className="focus-ring group flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-paper-soft/70 sm:gap-4 sm:px-5"
    >
      <span className="hidden w-6 shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted/60 sm:block">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.9375rem] font-medium text-ink">{card.title}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted">{card.recallPrompt}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StepBadge step={card.step} className="sm:hidden" />
          {(Array.isArray(card.tags) ? card.tags.slice(0, 3) : []).map((tag) => (
            <TagChip key={tag} tag={tag} />
          ))}
          {card.suspended ? <Badge tone="amber">Suspended</Badge> : null}
        </div>
      </div>
      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        <StepBadge step={card.step} />
        <span className="font-mono text-[0.6875rem] text-muted">{formatDue(card.dueAt)}</span>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent opacity-80 transition-opacity duration-150 group-hover:opacity-100">
        Review
        <IconChevronRight size={13} />
      </span>
    </Link>
  );
}

function TodaySkeleton() {
  return (
    <div aria-busy="true" className="space-y-8">
      <div>
        <div className="h-2.5 w-40 animate-pulse rounded-full bg-paper-deep/80" />
        <div className="mt-4 h-9 w-64 animate-pulse rounded-lg bg-paper-deep" />
        <div className="mt-3 h-3 w-80 animate-pulse rounded-full bg-paper-deep/70" />
      </div>
      <div className="card-surface h-48 animate-pulse bg-paper-soft/40" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="card-surface h-28 animate-pulse bg-paper-soft/40" />
        ))}
      </div>
      <div className="card-surface h-56 animate-pulse bg-paper-soft/40" />
    </div>
  );
}

export function TodayScreen() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [today, nextStats] = await Promise.all([
          apiGet<TodayResponse>('/api/today?limit=30', controller.signal),
          apiGet<StatsData>('/api/stats', controller.signal).catch(() => null),
        ]);
        if (!active) return;
        setData(today);
        setStats(nextStats);
      } catch (err) {
        if (!active || isAbortError(err)) return;
        setError(errorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  const counts = data?.counts;
  const due = Array.isArray(data?.due) ? data.due : [];
  const dueCount = counts?.due ?? 0;
  const reviewedToday = counts?.reviewedToday ?? 0;
  const rememberedToday = counts?.rememberedToday ?? 0;
  const streak = stats?.streakDays ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={now ? formatWeekdayDate(now) : 'Today'}
        title={now ? `${greeting(now)}.` : 'Today.'}
        description="A short pass through what is due. The ladder keeps the rest of the schedule."
        actions={
          <Link href="/capture" className={buttonStyles('secondary', 'md')}>
            <IconPen size={15} />
            Capture
          </Link>
        }
      />

      {loading ? (
        <TodaySkeleton />
      ) : error ? (
        <div className="card-surface p-8 text-center" role="alert">
          <p className="label-caps">Today's queue</p>
          <h2 className="mt-2 font-display text-2xl text-ink">We could not load your queue</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{error}</p>
          <Button variant="primary" className="mt-5" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {dueCount > 0 ? (
            <section className="card-surface relative animate-rise overflow-hidden p-6 sm:p-8" aria-labelledby="today-hero">
              <span
                className="absolute inset-y-8 left-0 w-[2px] rounded-full bg-accent/40"
                aria-hidden="true"
              />
              <div className="grid gap-6 pl-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-10 sm:pl-6">
                <div>
                  <p className="label-caps">Today's queue</p>
                  <h2 id="today-hero" className="mt-2 font-display text-[3.25rem] leading-none text-ink">
                    {dueCount}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {pluralize(dueCount, 'card')} waiting for recall
                  </p>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                    {reviewedToday > 0
                      ? `${pluralize(reviewedToday, 'review')} done today, ${rememberedToday} remembered. Keep the streak calm and steady.`
                      : 'Start with the first card. Answer from memory before you peek at the key points.'}
                  </p>
                </div>
                <div className="flex flex-col items-stretch gap-2 sm:items-end">
                  <Link href="/review" className={buttonStyles('primary', 'lg')}>
                    Start review
                    <IconArrowRight size={16} />
                  </Link>
                  <Link
                    href="/library"
                    className={buttonStyles('ghost', 'sm', 'justify-center text-muted')}
                  >
                    Browse the library
                  </Link>
                </div>
              </div>
            </section>
          ) : (
            <EmptyState
              icon={<IconSun size={22} />}
              title="You're clear for today"
              body={
                (counts?.total ?? 0) === 0
                  ? 'Your desk is empty. Capture a note or article and Recall drafts the first card for you.'
                  : 'Nothing due — capture something new, or let the ladder rest until tomorrow.'
              }
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Link href="/capture" className={buttonStyles('primary', 'md')}>
                    {(counts?.total ?? 0) === 0 ? 'Capture your first card' : 'Capture a card'}
                    <IconArrowRight size={15} />
                  </Link>
                  <Link href="/library" className={buttonStyles('secondary', 'md')}>
                    Browse library
                  </Link>
                </div>
              }
            />
          )}

          <section aria-label="Today at a glance" className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Due now"
              value={dueCount}
              hint={dueCount === 0 ? 'Queue is empty' : 'Ready when you are'}
              icon={<IconClock size={17} />}
            />
            <StatTile
              label="Reviewed today"
              value={reviewedToday}
              hint={reviewedToday === 0 ? 'No reviews yet today' : `${rememberedToday} remembered`}
              icon={<IconCheck size={17} />}
            />
            <StatTile
              label="Streak"
              value={streak === null ? '—' : streak}
              hint={
                streak === null
                  ? 'Unavailable right now'
                  : streak === 0
                    ? 'Review today to begin'
                    : `${pluralize(streak, 'day')} in a row`
              }
              icon={<IconFlame size={17} />}
            />
          </section>

          <section aria-labelledby="due-list-heading">
            <SectionLabel
              action={
                due.length > 0 ? (
                  <span className="font-mono text-[0.6875rem] tabular-nums text-muted">
                    {due.length} of {dueCount} shown
                  </span>
                ) : null
              }
            >
              <span id="due-list-heading">Due now</span>
            </SectionLabel>

            {due.length > 0 ? (
              <div className="card-surface mt-3 divide-y divide-line/70 overflow-hidden">
                {due.map((card, index) => (
                  <DueRow key={card.id} card={card} index={index} />
                ))}
              </div>
            ) : (
              <div className={cx('card-surface mt-3 px-5 py-8 text-center')}>
                <p className="text-sm text-muted">
                  Nothing due — capture something new, or come back after the next interval.
                </p>
                <Link
                  href="/capture"
                  className={buttonStyles('secondary', 'sm', 'mt-4')}
                >
                  Capture a card
                </Link>
              </div>
            )}

            {dueCount > due.length && due.length > 0 ? (
              <p className="mt-2 text-xs text-muted">
                Showing the first {due.length} due cards. Start review to work through the queue.
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
