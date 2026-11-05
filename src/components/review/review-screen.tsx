'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { IconArrowLeft, IconCheck, IconClock } from '@/components/icons';
import { Button, EmptyState, Meter, Skeleton, buttonStyles } from '@/components/ui';
import { apiGet, errorMessage, isAbortError } from '@/lib/client/api';
import type { CardDetailResponse, TodayResponse } from '@/lib/client/api-types';
import { pluralize } from '@/lib/client/format';
import { useToast } from '@/lib/client/toast';
import type { Notebox } from '@/lib/db/types';
import { ReviewCard } from './review-card';

function ReviewSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="card-surface space-y-4 p-6">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-3/5" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
    </div>
  );
}

export function ReviewScreen() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get('card');
  const toast = useToast();

  const [queue, setQueue] = useState<Notebox[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [finished, setFinished] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const data = await apiGet<TodayResponse>('/api/today?limit=30', controller.signal);
        if (!active) return;

        const due = Array.isArray(data.due) ? data.due.filter((card) => !card.suspended) : [];
        let startIndex = 0;
        let pickedUp = false;

        if (requestedId) {
          const found = due.findIndex((card) => card.id === requestedId);
          if (found >= 0) {
            startIndex = found;
            pickedUp = true;
          } else {
            // The requested card may sit outside the due window (e.g. more than
            // 30 cards waiting). Fetch it directly so "Review it now" from
            // capture always lands on the card the user just created.
            try {
              const detail = await apiGet<CardDetailResponse>(
                `/api/cards/${encodeURIComponent(requestedId)}`,
                controller.signal,
              );
              if (!active) return;
              const card = detail.notebox;
              if (card && !card.suspended && new Date(card.dueAt).getTime() <= Date.now()) {
                due.unshift(card);
                startIndex = 0;
                pickedUp = true;
              }
            } catch (detailError) {
              if (!active || isAbortError(detailError)) return;
              // Fall through to the queue (or the empty state) below.
            }
          }
        }

        setQueue(due);
        setIndex(startIndex);
        setFinished(false);
        setReviewedCount(0);
        if (requestedId && !pickedUp && due.length > 0) {
          toast.info("That card isn't due right now — starting at the top of today's queue.");
        }
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
  }, [reloadToken, requestedId, toast]);

  const advance = useCallback(
    (saved: boolean) => {
      if (saved) setReviewedCount((count) => count + 1);
      if (index + 1 >= queue.length) setFinished(true);
      else setIndex((current) => current + 1);
    },
    [index, queue.length],
  );

  const current = queue[index];

  if (loading) return <ReviewSkeleton />;

  if (error) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card-surface p-8 text-center" role="alert">
          <p className="label-caps">Focus mode</p>
          <h1 className="mt-2 font-display text-2xl text-ink">We could not load your queue</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{error}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" onClick={() => setReloadToken((token) => token + 1)}>
              Try again
            </Button>
            <Link href="/today" className={buttonStyles('secondary', 'md')}>
              Back to today
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/today" className={buttonStyles('ghost', 'sm', '-ml-2')}>
            <IconArrowLeft size={14} />
            Exit focus
          </Link>
          <span className="label-caps">Focus mode</span>
        </div>
        <EmptyState
          icon={<IconClock size={22} />}
          title="Nothing is due right now"
          body={
            requestedId
              ? "That card isn't waiting today. Nothing else is due — the ladder will call cards back when it's time."
              : 'The ladder has no cards waiting. Capture something new, or come back after the next interval.'
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/capture" className={buttonStyles('primary', 'md')}>
                Capture a card
              </Link>
              <Link href="/today" className={buttonStyles('secondary', 'md')}>
                Back to today
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  if (finished || !current) {
    const allReviewed = reviewedCount >= queue.length;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/today" className={buttonStyles('ghost', 'sm', '-ml-2')}>
            <IconArrowLeft size={14} />
            Exit focus
          </Link>
          <span className="label-caps">Session complete</span>
        </div>
        <EmptyState
          icon={<IconCheck size={22} />}
          title="You're clear for today"
          body={
            allReviewed
              ? `All ${pluralize(queue.length, 'card')} reviewed. The next intervals are already scheduled — nothing else to decide.`
              : `You reviewed ${reviewedCount} of ${pluralize(queue.length, 'card')}. Skipped cards stay due, ready whenever you are.`
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/today" className={buttonStyles('primary', 'md')}>
                Back to today
              </Link>
              <Link href="/capture" className={buttonStyles('secondary', 'md')}>
                Capture a card
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <Link href="/today" className={buttonStyles('ghost', 'sm', '-ml-2')}>
          <IconArrowLeft size={14} />
          Exit focus
        </Link>
        <span className="label-caps tabular-nums">
          Card {index + 1} of {queue.length}
        </span>
      </div>
      <Meter
        value={index + 1}
        max={queue.length}
        label={`Recall progress: card ${index + 1} of ${queue.length}`}
        className="mt-2.5"
      />
      <div className="mt-4">
        <ReviewCard
          key={current.id}
          card={current}
          position={index + 1}
          total={queue.length}
          onNext={advance}
        />
      </div>
      <p className="mt-5 text-center text-[0.6875rem] leading-relaxed text-muted">
        The ladder schedules the next review. AI can suggest a grade; it never moves the schedule.
      </p>
    </div>
  );
}
