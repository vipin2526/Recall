'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardsResponse, StatsData } from '@/lib/client/api-types';
import { apiGet, errorMessage, isAbortError } from '@/lib/client/api';
import { useDebouncedValue } from '@/lib/client/hooks';
import { formatDue, pluralize } from '@/lib/client/format';
import { useToast } from '@/lib/client/toast';
import type { Notebox } from '@/lib/db/types';
import {
  IconBook,
  IconChevronRight,
  IconPen,
  IconSearch,
  IconX,
} from '@/components/icons';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  SectionLabel,
  Skeleton,
  StepBadge,
  TagChip,
  buttonStyles,
  cx,
} from '@/components/ui';
import { CardDetail } from './card-detail';

const PAGE_SIZE = 20;

function buildCardsQuery(query: string, tag: string, offset: number): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('query', query.trim());
  if (tag) params.set('tag', tag);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  return `/api/cards?${params.toString()}`;
}

function TagPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] transition-colors duration-150',
        active
          ? 'border-accent/30 bg-accent-soft text-accent-deep'
          : 'border-line bg-paper-soft/60 text-muted hover:border-[#c9bfae] hover:text-ink',
      )}
    >
      {label}
      {typeof count === 'number' ? <span className="opacity-60">{count}</span> : null}
    </button>
  );
}

export function LibraryScreen() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const initialQuery = searchParams.get('q') ?? '';
  const initialTag = searchParams.get('tag') ?? '';

  const [query, setQuery] = useState(initialQuery);
  const debouncedQuery = useDebouncedValue(query, 250);
  const [tag, setTag] = useState(initialTag);

  const [items, setItems] = useState<Notebox[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsToken, setStatsToken] = useState(0);
  const moreRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<StatsData>('/api/stats', controller.signal)
      .then((data) => setStats(data))
      .catch(() => undefined);
    return () => controller.abort();
  }, [statsToken]);

  useEffect(() => {
    moreRef.current?.abort();
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    apiGet<CardsResponse>(buildCardsQuery(debouncedQuery, tag, 0), controller.signal)
      .then((data) => {
        if (!active) return;
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedQuery, tag, reloadToken]);

  const loadMore = async () => {
    if (loading || loadingMore) return;
    const controller = new AbortController();
    moreRef.current = controller;
    setLoadingMore(true);
    try {
      const data = await apiGet<CardsResponse>(
        buildCardsQuery(debouncedQuery, tag, items.length),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setItems((current) => {
        const seen = new Set(current.map((card) => card.id));
        const next = Array.isArray(data.items) ? data.items : [];
        return [...current, ...next.filter((card) => !seen.has(card.id))];
      });
      if (typeof data.total === 'number') setTotal(data.total);
    } catch (err) {
      if (!isAbortError(err)) toast.error(errorMessage(err));
    } finally {
      if (moreRef.current === controller) moreRef.current = null;
      setLoadingMore(false);
    }
  };

  const tagOptions = useMemo(() => {
    const allTags = Array.isArray(stats?.tags) ? stats.tags : [];
    const list = [...allTags].sort((a, b) => b.count - a.count).slice(0, 12);
    if (tag && !list.some((entry) => entry.tag === tag)) {
      list.unshift({ tag, count: 0 });
    }
    return list;
  }, [stats, tag]);

  const hasFilters = debouncedQuery.trim().length > 0 || tag.length > 0;
  const remaining = Math.max(0, total - items.length);

  const clearFilters = () => {
    setQuery('');
    setTag('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Library"
        title="Everything you've captured"
        description={
          total > 0
            ? `${pluralize(total, 'card')} on the shelf. Open one to read the key points or fix a prompt.`
            : 'Search, read the whole card, or fix a prompt. Capture something new when you are ready.'
        }
        actions={
          <Link href="/capture" className={buttonStyles('primary', 'md')}>
            <IconPen size={15} />
            Capture
          </Link>
        }
      />

      <section className="card-surface animate-rise p-3.5 sm:p-4" aria-label="Search and filter">
        <div className="relative">
          <IconSearch
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted/70"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, prompts and key points…"
            aria-label="Search cards"
            className="pl-9 pr-10"
            autoComplete="off"
          />
          {query.length > 0 ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="focus-ring absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:bg-paper-deep/60 hover:text-ink"
            >
              <IconX size={14} />
            </button>
          ) : null}
        </div>

        {tagOptions.length > 0 || tag ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <TagPill
              label="All"
              count={stats?.totalCards}
              active={!tag}
              onClick={() => setTag('')}
            />
            {tagOptions.map((entry) => (
              <TagPill
                key={entry.tag}
                label={`#${entry.tag}`}
                count={entry.count}
                active={tag === entry.tag}
                onClick={() => setTag(tag === entry.tag ? '' : entry.tag)}
              />
            ))}
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="focus-ring ml-auto rounded text-xs font-medium text-accent underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-label="Cards">
        <SectionLabel
          action={
            !loading && !error ? (
              <span className="font-mono text-[0.6875rem] tabular-nums text-muted">
                {items.length} of {total} shown
              </span>
            ) : null
          }
        >
          {hasFilters ? 'Search results' : 'All cards'}
        </SectionLabel>

        <div className="mt-3">
          {loading ? (
            <div className="card-surface space-y-4 p-5" aria-busy="true">
              {[0, 1, 2, 3].map((key) => (
                <div key={key} className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="card-surface p-7 text-center" role="alert">
              <p className="text-sm text-muted">{error}</p>
              <Button
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            hasFilters ? (
              <EmptyState
                compact
                icon={<IconSearch size={20} />}
                title="No cards match"
                body="Try a different phrase, or remove the tag filter. Nothing was deleted."
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<IconBook size={22} />}
                title="Your library is empty"
                body="Capture a note or article and Recall drafts the first card. Everything you save lives here."
                action={
                  <Link href="/capture" className={buttonStyles('primary', 'md')}>
                    Capture your first card
                  </Link>
                }
              />
            )
          ) : (
            <div className="card-surface divide-y divide-line/70 overflow-hidden">
              {items.map((card) => {
                const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
                const cardTags = Array.isArray(card.tags) ? card.tags : [];
                return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setSelectedId(card.id)}
                  className="focus-ring group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-paper-soft/70 sm:gap-4 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className={cx(
                          'truncate text-[0.9375rem] font-medium',
                          card.suspended ? 'text-muted' : 'text-ink',
                        )}
                      >
                        {card.title}
                      </p>
                      {card.suspended ? <Badge tone="amber">Suspended</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {pluralize(keyPoints.length, 'key point')}
                      <span className="sm:hidden"> · {formatDue(card.dueAt)}</span>
                    </p>
                    {cardTags.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {cardTags.map((tagName) => (
                          <TagChip key={tagName} tag={tagName} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                    <StepBadge step={card.step} />
                    <span className="font-mono text-[0.6875rem] text-muted">
                      {formatDue(card.dueAt)}
                    </span>
                  </div>
                  <IconChevronRight
                    size={15}
                    className="shrink-0 text-muted/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-muted"
                  />
                </button>
                );
              })}
            </div>
          )}
        </div>

        {!loading && !error && remaining > 0 ? (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              onClick={() => {
                void loadMore();
              }}
              loading={loadingMore}
            >
              Load {Math.min(PAGE_SIZE, remaining)} more
              <span className="font-mono text-[0.6875rem] text-muted">
                {remaining} remaining
              </span>
            </Button>
          </div>
        ) : null}
      </section>

      {selectedId ? (
        <CardDetail
          key={selectedId}
          cardId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={(next) => {
            setItems((current) => current.map((card) => (card.id === next.id ? next : card)));
          }}
          onDeleted={(id) => {
            setItems((current) => current.filter((card) => card.id !== id));
            setTotal((value) => Math.max(0, value - 1));
            setSelectedId(null);
            setStatsToken((token) => token + 1);
          }}
        />
      ) : null}
    </div>
  );
}
