'use client';

import { useEffect, useState } from 'react';
import type { MonitorData } from '@/lib/client/api-types';
import { apiGet, apiPost, errorMessage, isAbortError } from '@/lib/client/api';
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRelativeTime,
  formatUsd,
  capitalize,
} from '@/lib/client/format';
import { createIdempotencyKey } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { useToast } from '@/lib/client/toast';
import {
  IconAlert,
  IconCheck,
  IconPulse,
  IconRefresh,
  IconThumbsDown,
  IconThumbsUp,
  IconX,
} from '@/components/icons';
import {
  Badge,
  Button,
  EmptyState,
  Notice,
  PageHeader,
  SectionLabel,
  SegmentedControl,
  StatTile,
  ThumbFeedback,
  cx,
} from '@/components/ui';

const WINDOWS = { '24h': 24, '7d': 168 } as const;
type WindowKey = keyof typeof WINDOWS;

type FeedbackSurface = 'capture' | 'grade' | 'coach';

function surfaceFor(kind: string): FeedbackSurface | null {
  return kind === 'capture' || kind === 'grade' || kind === 'coach' ? kind : null;
}

function MonitorSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="card-surface h-16 animate-pulse bg-paper-soft/40" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((key) => (
          <div key={key} className="card-surface h-28 animate-pulse bg-paper-soft/40" />
        ))}
      </div>
      <div className="card-surface h-52 animate-pulse bg-paper-soft/40" />
    </div>
  );
}

export function MonitorScreen() {
  const { session } = useSession();
  const toast = useToast();

  const [windowKey, setWindowKey] = useState<WindowKey>('24h');
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [callFeedback, setCallFeedback] = useState<Record<string, 1 | -1>>({});
  const [pendingFeedback, setPendingFeedback] = useState<string | null>(null);

  const hours = WINDOWS[windowKey];
  const mock = session.ai.mode === 'mock';

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    apiGet<MonitorData>(`/api/monitor?hours=${hours}`, controller.signal)
      .then((next) => {
        if (!active) return;
        setData(next);
        setCallFeedback({});
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
  }, [hours, reloadToken]);

  const rateCall = async (callId: string, kind: string, rating: 1 | -1) => {
    const surface = surfaceFor(kind);
    if (!surface || pendingFeedback) return;
    setPendingFeedback(callId);
    try {
      await apiPost<{ ok: true }>('/api/ai/feedback', {
        surface,
        rating,
        ai_call_id: callId,
        idempotency_key: createIdempotencyKey(),
      });
      setCallFeedback((current) => ({ ...current, [callId]: rating }));
      toast.success('Thanks — noted.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPendingFeedback(null);
    }
  };

  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const byKind = Array.isArray(data?.byKind) ? data.byKind : [];
  const recent = Array.isArray(data?.recent) ? data.recent : [];
  const feedback = {
    up: typeof data?.feedback?.up === 'number' ? data.feedback.up : 0,
    down: typeof data?.feedback?.down === 'number' ? data.feedback.down : 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitor"
        title="AI operations"
        description="Every capture, grade and recap — latency, validation and cost. Scheduling never depends on this surface."
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl<WindowKey>
              label="Time window"
              value={windowKey}
              onChange={setWindowKey}
              size="sm"
              options={[
                { value: '24h', label: '24h' },
                { value: '7d', label: '7d' },
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReloadToken((token) => token + 1)}
              disabled={loading}
            >
              <IconRefresh size={14} />
              Refresh
            </Button>
          </div>
        }
      />

      <Notice tone={mock ? 'warning' : 'info'}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={mock ? 'amber' : 'accent'}>
            {mock ? 'Offline mock' : 'Live AI'}
          </Badge>
          <span>
            {mock
              ? 'No API key configured, so capture, grading and coaching run against deterministic local fixtures. Latency and cost figures are simulated — the pipeline is real.'
              : `Requests go to ${session.ai.model}. Every call is logged here; none of them can change a review interval.`}
          </span>
        </div>
      </Notice>

      {loading ? (
        <MonitorSkeleton />
      ) : error ? (
        <div className="card-surface p-7 text-center" role="alert">
          <p className="label-caps">Monitor</p>
          <h2 className="mt-2 font-display text-2xl text-ink">We could not load AI operations</h2>
          <p className="mt-2 text-sm text-muted">{error}</p>
          <Button
            variant="primary"
            size="sm"
            className="mt-4"
            onClick={() => setReloadToken((token) => token + 1)}
          >
            Try again
          </Button>
        </div>
      ) : !data || data.totalCalls === 0 ? (
        <EmptyState
          icon={<IconPulse size={22} />}
          title="No AI calls in this window"
          body={
            mock
              ? 'Mock mode is on, but nothing has run yet. Capture a link or grade an answer to populate the monitor.'
              : 'Capture a link, grade an answer or generate a weekly recap to populate the monitor.'
          }
          action={
            <Button
              variant="secondary"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              <IconRefresh size={14} />
              Refresh
            </Button>
          }
        />
      ) : (
        <>
          <section aria-label="AI call metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile
              label="Calls"
              value={data.totalCalls}
              hint={`${capitalize(windowKey === '24h' ? 'last 24 hours' : 'last 7 days')}`}
              icon={<IconPulse size={17} />}
            />
            <StatTile
              label="Validation failures"
              value={formatPercent(data.validationFailRate, 1)}
              hint="Share of calls that failed validation"
              icon={<IconAlert size={17} />}
            />
            <StatTile
              label="p95 latency"
              value={formatDuration(data.p95LatencyMs)}
              hint={`Avg ${formatDuration(data.avgLatencyMs)}`}
              icon={<IconRefresh size={17} />}
            />
            <StatTile
              label="Cost"
              value={formatUsd(data.costUsd)}
              hint={mock ? 'Simulated in mock mode' : 'Estimated token cost'}
              icon={<IconCheck size={17} />}
            />
            <StatTile
              label="Cache hit rate"
              value={formatPercent(data.cacheHitRate, 1)}
              hint="Repeat sources and grading runs"
              icon={<IconCheck size={17} />}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card-surface p-5" aria-label="Alerts">
              <SectionLabel
                action={
                  <Badge tone={alerts.some((alert) => alert.level === 'error') ? 'danger' : alerts.length > 0 ? 'amber' : 'neutral'}>
                    {alerts.length}
                  </Badge>
                }
              >
                Alerts
              </SectionLabel>
              {alerts.length === 0 ? (
                <p className="mt-4 text-sm text-muted">
                  No alerts in this window. Latency, validation and failure rates look calm.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {alerts.map((alert, index) => (
                    <li
                      key={`${alert.level}-${index}`}
                      className={cx(
                        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-relaxed',
                        alert.level === 'error'
                          ? 'border-danger/25 bg-danger/10 text-danger'
                          : 'border-amber/25 bg-amber-soft/50 text-[#7c3d06]',
                      )}
                    >
                      <IconAlert size={15} className="mt-0.5 shrink-0" />
                      <span>{alert.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card-surface p-5" aria-label="Human feedback">
              <SectionLabel>Human feedback</SectionLabel>
              <div className="mt-4 flex items-center gap-8">
                <div className="flex items-center gap-2">
                  <IconThumbsUp size={18} className="text-accent" />
                  <span className="font-display text-2xl text-ink">{feedback.up}</span>
                  <span className="text-xs text-muted">helpful</span>
                </div>
                <div className="flex items-center gap-2">
                  <IconThumbsDown size={18} className="text-danger" />
                  <span className="font-display text-2xl text-ink">{feedback.down}</span>
                  <span className="text-xs text-muted">not helpful</span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Thumbs from drafts, grades and weekly recaps. A quiet quality signal — never a
                ranking of you.
              </p>
            </section>
          </div>

          <section className="card-surface overflow-hidden" aria-label="Calls by kind">
            <div className="px-5 pt-5">
              <SectionLabel>By kind</SectionLabel>
            </div>
            {byKind.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No breakdown available for this window.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <caption className="sr-only">AI calls grouped by kind</caption>
                  <thead>
                    <tr className="border-y border-line bg-paper-deep/30 text-left">
                      <th scope="col" className="label-caps px-5 py-2 font-medium">Kind</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Calls</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Validation fails</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">p95</th>
                      <th scope="col" className="label-caps px-5 py-2 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {byKind.map((row) => (
                      <tr key={row.kind}>
                        <td className="px-5 py-2.5">
                          <Badge tone="outline">{capitalize(row.kind)}</Badge>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums">{row.calls}</td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                          {formatPercent(row.validationFailRate, 1)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                          {formatDuration(row.p95LatencyMs)}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-xs tabular-nums">
                          {formatUsd(row.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card-surface overflow-hidden" aria-label="Recent AI calls">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
              <SectionLabel>Recent calls</SectionLabel>
              <span className="font-mono text-[0.6875rem] text-muted">{recent.length} shown</span>
            </div>
            {recent.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No calls recorded in this window.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[54rem] text-sm">
                  <caption className="sr-only">Most recent AI calls</caption>
                  <thead>
                    <tr className="border-y border-line bg-paper-deep/30 text-left">
                      <th scope="col" className="label-caps px-5 py-2 font-medium">Time</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Kind</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Provider / model</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Latency</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Valid</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Cache</th>
                      <th scope="col" className="label-caps px-3 py-2 font-medium">Cost</th>
                      <th scope="col" className="label-caps px-5 py-2 font-medium">Feedback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {recent.map((call) => {
                      const surface = surfaceFor(call.kind);
                      return (
                        <tr key={call.id} className="align-top transition-colors hover:bg-paper-soft/60">
                          <td
                            className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-muted"
                            title={formatDateTime(call.createdAt)}
                          >
                            {formatRelativeTime(call.createdAt)}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge tone="outline">{capitalize(call.kind)}</Badge>
                          </td>
                          <td className="max-w-[16rem] px-3 py-2.5">
                            <span className="font-mono text-xs text-ink">
                              {call.provider} · {call.model}
                            </span>
                            {call.error ? (
                              <span className="mt-0.5 block truncate text-[0.6875rem] text-danger" title={call.error}>
                                {call.error}
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums">
                            {formatDuration(call.latencyMs)}
                          </td>
                          <td className="px-3 py-2.5">
                            {call.validationOk ? (
                              <span className="inline-flex items-center gap-1 text-xs text-accent">
                                <IconCheck size={13} />
                                <span className="sr-only">Valid</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-danger">
                                <IconX size={13} />
                                <span className="sr-only">Invalid</span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted">
                            {call.cached ? 'Yes' : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums">
                            {formatUsd(call.costUsd)}
                          </td>
                          <td className="px-5 py-2.5">
                            {surface ? (
                              <ThumbFeedback
                                compact
                                value={callFeedback[call.id] ?? null}
                                onRate={(rating) => {
                                  void rateCall(call.id, call.kind, rating);
                                }}
                                disabled={pendingFeedback === call.id}
                                label="Rate this AI call"
                              />
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
