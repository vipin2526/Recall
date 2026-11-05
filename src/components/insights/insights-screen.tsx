'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CoachResponse, StatsData } from '@/lib/client/api-types';
import { apiGet, apiPost, errorMessage, isAbortError } from '@/lib/client/api';
import { formatPercent, formatShortDate, pluralize } from '@/lib/client/format';
import { createIdempotencyKey } from '@/lib/client/hooks';
import { useToast } from '@/lib/client/toast';
import type { CoachReport } from '@/lib/db/types';
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconChart,
  IconCheck,
  IconFlame,
  IconInfo,
  IconRefresh,
  IconSparkle,
} from '@/components/icons';
import {
  Badge,
  Button,
  Notice,
  PageHeader,
  SectionLabel,
  Skeleton,
  StatTile,
  ThumbFeedback,
  buttonStyles,
} from '@/components/ui';
import { ForecastChart, ReviewsChart, TagDistribution } from '@/components/charts';

function parseWeekStart(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : formatShortDate(date.getTime());
}

function InsightsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="card-surface h-28 animate-pulse bg-paper-soft/40" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-surface h-56 animate-pulse bg-paper-soft/40" />
        <div className="card-surface h-56 animate-pulse bg-paper-soft/40" />
      </div>
    </div>
  );
}

function CoachCard({
  report,
  loading,
  generating,
  error,
  onGenerate,
  onRetry,
}: {
  report: CoachReport | null;
  loading: boolean;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
  onRetry: () => void;
}) {
  const toast = useToast();
  const [feedback, setFeedback] = useState<1 | -1 | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);

  useEffect(() => {
    setFeedback(null);
  }, [report?.id]);

  const rate = async (rating: 1 | -1) => {
    if (feedbackPending) return;
    setFeedbackPending(true);
    try {
      await apiPost<{ ok: true }>('/api/ai/feedback', {
        surface: 'coach',
        rating,
        idempotency_key: createIdempotencyKey(),
      });
      setFeedback(rating);
      toast.success('Thanks — noted.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFeedbackPending(false);
    }
  };

  const lines = Array.isArray(report?.summary?.lines) ? report.summary.lines : [];
  const stats = report?.stats;

  return (
    <section className="card-surface animate-rise p-5 sm:p-7" aria-labelledby="coach-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="label-caps">Weekly coach</span>
          <Badge tone="accent">AI summary</Badge>
          {report ? (
            <span className="font-mono text-[0.6875rem] text-muted">
              Week of {parseWeekStart(report.weekStart)}
            </span>
          ) : null}
        </div>
        {report ? (
          <ThumbFeedback
            value={feedback}
            onRate={(rating) => {
              void rate(rating);
            }}
            disabled={feedbackPending}
            label="Was this weekly recap useful?"
          />
        ) : null}
      </div>

      {loading || generating ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
          <p className="text-xs text-muted" role="status">
            {generating ? 'Reading your week…' : 'Loading the weekly recap…'}
          </p>
        </div>
      ) : error && !report ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            <IconRefresh size={14} />
            Try again
          </Button>
        </div>
      ) : report ? (
        <div className="mt-4">
          <h2 id="coach-heading" className="text-balance font-display text-2xl leading-snug text-ink">
            {report.summary?.headline ?? 'Your week in recall'}
          </h2>
          <ol className="mt-4 space-y-2.5">
            {lines.map((line, index) => (
              <li key={index} className="flex gap-3 text-sm leading-relaxed text-ink/90">
                <span className="mt-0.5 font-mono text-[0.6875rem] text-accent/80">{index + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>

          {stats ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-muted">
              <span>
                <span className="font-mono text-ink">{stats.reviews}</span>{' '}
                {stats.reviews === 1 ? 'review' : 'reviews'}
              </span>
              <span>
                <span className="font-mono text-ink">{formatPercent(stats.accuracy)}</span> remembered
              </span>
              <span>
                <span className="font-mono text-ink">{stats.activeDays}</span>{' '}
                {stats.activeDays === 1 ? 'active day' : 'active days'}
              </span>
              <span>
                <span className="font-mono text-ink">{stats.dueCount}</span> due now
              </span>
            </div>
          ) : null}

          <p className="mt-4 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-muted">
            <IconInfo size={13} className="mt-px shrink-0" />
            Numbers come from your review database, not the model. The coach only writes the
            sentences — it never changes an interval.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={onGenerate}
              loading={generating}
              disabled={generating}
            >
              <IconSparkle size={14} />
              Regenerate
            </Button>
            <span className="text-xs text-muted">
              Recomputes the numbers, then rewrites the three lines.
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <h2 id="coach-heading" className="text-balance font-display text-2xl text-ink">
            A short weekly read of your recall
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            Three lines on what held, what slipped, and what to notice next week. Built from your
            reviews — the model just writes the prose.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={onGenerate}>
              <IconSparkle size={15} />
              Generate this week's recap
            </Button>
            <span className="text-xs text-muted">One AI call. Mark it helpful or not.</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function InsightsScreen() {
  const toast = useToast();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsToken, setStatsToken] = useState(0);

  const [report, setReport] = useState<CoachReport | null>(null);
  const [coachLoading, setCoachLoading] = useState(true);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachToken, setCoachToken] = useState(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setStatsLoading(true);
    setStatsError(null);

    apiGet<StatsData>('/api/stats', controller.signal)
      .then((data) => {
        if (!active) return;
        setStats(data);
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return;
        setStatsError(errorMessage(err));
      })
      .finally(() => {
        if (active) setStatsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [statsToken]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCoachLoading(true);
    setCoachError(null);

    apiGet<CoachResponse>('/api/coach', controller.signal)
      .then((data) => {
        if (!active) return;
        setReport(data.report);
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return;
        setCoachError(errorMessage(err));
      })
      .finally(() => {
        if (active) setCoachLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [coachToken]);

  const generateCoach = async () => {
    if (generating) return;
    setGenerating(true);
    setCoachError(null);
    try {
      const data = await apiPost<CoachResponse>('/api/coach', {});
      setReport(data.report);
      toast.success('Weekly recap ready.');
    } catch (err) {
      const message = errorMessage(err);
      setCoachError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  const reviewsByDay = Array.isArray(stats?.reviewsByDay) ? stats.reviewsByDay : [];
  const forecast = Array.isArray(stats?.forecast) ? stats.forecast : [];
  const tagCounts = Array.isArray(stats?.tags) ? stats.tags : [];
  const reviews14d = reviewsByDay.reduce((sum, point) => sum + (point?.reviews ?? 0), 0);
  const hardest = Array.isArray(report?.stats?.hardest) ? report.stats.hardest : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="The shape of your recall"
        description="A fourteen-day view in plain numbers. The weekly coach reads them; nothing here changes the ladder."
        actions={
          <Link href="/review" className={buttonStyles('secondary', 'md')}>
            Start review
            <IconArrowRight size={15} />
          </Link>
        }
      />

      {statsLoading ? (
        <InsightsSkeleton />
      ) : statsError || !stats ? (
        <div className="card-surface p-7 text-center" role="alert">
          <p className="label-caps">Statistics</p>
          <h2 className="mt-2 font-display text-2xl text-ink">We could not load your stats</h2>
          <p className="mt-2 text-sm text-muted">{statsError ?? 'Try again in a moment.'}</p>
          <Button
            variant="primary"
            size="sm"
            className="mt-4"
            onClick={() => setStatsToken((token) => token + 1)}
          >
            Try again
          </Button>
        </div>
      ) : (
        <>
          <section aria-label="Key stats" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Accuracy · 7d"
              value={formatPercent(stats.accuracy7d)}
              hint="Remembered share of reviews"
              icon={<IconCheck size={17} />}
            />
            <StatTile
              label="Reviews · 14d"
              value={reviews14d}
              hint={pluralize(reviews14d, 'review')}
              icon={<IconChart size={17} />}
            />
            <StatTile
              label="Streak"
              value={stats.streakDays}
              hint={stats.streakDays > 0 ? 'days in a row' : 'Review today to begin'}
              icon={<IconFlame size={17} />}
            />
            <StatTile
              label="Total cards"
              value={stats.totalCards}
              hint={`${stats.dueNow} due now`}
              icon={<IconBook size={17} />}
            />
          </section>

          <CoachCard
            report={report}
            loading={coachLoading}
            generating={generating}
            error={coachError}
            onGenerate={() => {
              void generateCoach();
            }}
            onRetry={() => setCoachToken((token) => token + 1)}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card-surface p-5" aria-label="Reviews over fourteen days">
              <SectionLabel>Reviews · 14 days</SectionLabel>
              <div className="mt-4">
                <ReviewsChart data={reviewsByDay} />
              </div>
            </section>

            <section className="card-surface p-5" aria-label="Due forecast">
              <SectionLabel>Due forecast · 14 days</SectionLabel>
              <div className="mt-4">
                <ForecastChart data={forecast} />
              </div>
            </section>

            <section className="card-surface p-5" aria-label="Tag distribution">
              <SectionLabel
                action={
                  <span className="font-mono text-[0.6875rem] text-muted">
                    {tagCounts.length} tags
                  </span>
                }
              >
                Library weight
              </SectionLabel>
              <div className="mt-4">
                <TagDistribution tags={tagCounts} />
              </div>
            </section>

            <section className="card-surface p-5" aria-label="Hardest cards">
              <SectionLabel
                action={
                  report ? (
                    <span className="font-mono text-[0.6875rem] text-muted">from your recap</span>
                  ) : null
                }
              >
                Hardest cards
              </SectionLabel>
              {hardest.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-7 text-center text-sm text-muted">
                  {report
                    ? 'No repeated misses this week. A quiet, steady run.'
                    : 'Your hardest cards appear after the weekly recap.'}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line/70">
                  {hardest.slice(0, 5).map((entry) => (
                    <li key={entry.noteboxId} className="py-2.5">
                      <Link
                        href={`/library?q=${encodeURIComponent(entry.title)}`}
                        className="focus-ring group flex items-center gap-3 rounded-md"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-ink group-hover:text-accent">
                          {entry.title}
                        </span>
                        <Badge tone="amber">
                          {pluralize(entry.misses, 'miss', 'misses')}
                        </Badge>
                        <IconArrowRight
                          size={13}
                          className="shrink-0 text-muted/50 transition-transform group-hover:translate-x-0.5"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {coachError && report ? (
            <Notice tone="warning">
              <span className="inline-flex items-center gap-1.5">
                <IconAlert size={14} />
                The coach could not be refreshed: {coachError}
              </span>
            </Notice>
          ) : null}
        </>
      )}
    </div>
  );
}
