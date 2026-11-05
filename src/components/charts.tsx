import type { UserStats } from '@/lib/db/types';
import { formatShortDate, pluralize } from '@/lib/client/format';
import { cx } from '@/components/ui';

function dateFromKey(key: string): Date {
  const parsed = new Date(`${key}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function ReviewsChart({ data }: { data: UserStats['reviewsByDay'] }) {
  const points = data.slice(-14);
  const max = Math.max(1, ...points.map((point) => point.reviews));
  const total = points.reduce((sum, point) => sum + point.reviews, 0);
  const remembered = points.reduce((sum, point) => sum + point.remembered, 0);

  return (
    <figure aria-label={`Reviews over the last ${points.length} days`}>
      <div className="flex items-end justify-between gap-2 pb-2">
        <div className="flex items-center gap-3 text-[0.6875rem] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-accent" aria-hidden="true" />
            Remembered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-[#d8cdb9]" aria-hidden="true" />
            Partial / forgot
          </span>
        </div>
        <span className="font-mono text-[0.6875rem] tabular-nums text-muted">
          {pluralize(total, 'review')} · {remembered} remembered
        </span>
      </div>
      {points.length === 0 ? (
        <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted">
          No reviews in this window yet.
        </div>
      ) : (
        <div className="flex h-36 items-end gap-1 border-b border-line pb-px sm:gap-2" role="img" aria-label={`${pluralize(total, 'review')}, ${remembered} remembered`}>
          {points.map((point) => {
            const date = dateFromKey(point.date);
            const height = (point.reviews / max) * 100;
            const rememberedShare = point.reviews > 0 ? (point.remembered / point.reviews) * 100 : 0;
            return (
              <div key={point.date} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <div
                  className="flex w-full max-w-7 flex-1 flex-col justify-end"
                  title={`${formatShortDate(date.getTime())} — ${pluralize(point.reviews, 'review')}, ${point.remembered} remembered`}
                >
                  {point.reviews > 0 ? (
                    <div
                      className="flex w-full flex-col overflow-hidden rounded-t-[3px] transition-opacity duration-150 group-hover:opacity-80"
                      style={{ height: `${Math.max(height, 4)}%` }}
                    >
                      <div className="w-full bg-[#d8cdb9]" style={{ flexGrow: 100 - rememberedShare }} />
                      <div className="w-full bg-accent" style={{ flexGrow: rememberedShare }} />
                    </div>
                  ) : (
                    <div className="h-0.5 w-full rounded-full bg-line/70" />
                  )}
                </div>
                <span className="font-mono text-[0.625rem] tabular-nums text-muted/80">
                  {date.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}

export function ForecastChart({ data }: { data: UserStats['forecast'] }) {
  const points = data.slice(0, 14);
  const max = Math.max(1, ...points.map((point) => point.count));
  const dueSoon = points.reduce((sum, point) => sum + point.count, 0);

  return (
    <figure aria-label={`Due forecast for the next ${points.length} days`}>
      <div className="flex items-center justify-between pb-2">
        <span className="text-[0.6875rem] text-muted">Cards coming due, by day</span>
        <span className="font-mono text-[0.6875rem] tabular-nums text-muted">
          {dueSoon} in {pluralize(points.length, 'day')}
        </span>
      </div>
      {points.length === 0 ? (
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted">
          Nothing scheduled yet.
        </div>
      ) : (
        <div className="flex h-28 items-end gap-1 border-b border-line pb-px sm:gap-2" role="img" aria-label={`${pluralize(dueSoon, 'card')} due in the next ${pluralize(points.length, 'day')}`}>
          {points.map((point) => {
            const date = dateFromKey(point.date);
            const height = (point.count / max) * 100;
            return (
              <div key={point.date} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <div className="flex w-full max-w-7 flex-1 items-end justify-center">
                  {point.count > 0 ? (
                    <div
                      className="w-full rounded-t-[3px] border border-accent/25 border-b-0 bg-accent/20 transition-colors duration-150 group-hover:bg-accent/35"
                      style={{ height: `${Math.max(height, 5)}%` }}
                      title={`${formatShortDate(date.getTime())} — ${point.count} due`}
                    />
                  ) : (
                    <div className="h-0.5 w-full rounded-full bg-line/70" />
                  )}
                </div>
                <span className="font-mono text-[0.625rem] tabular-nums text-muted/80">
                  {date.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}

export function TagDistribution({ tags }: { tags: UserStats['tags'] }) {
  const top = [...tags].sort((a, b) => b.count - a.count).slice(0, 8);
  const max = Math.max(1, ...top.map((entry) => entry.count));

  if (top.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
        Add tags when you capture cards to see how your library is weighted.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {top.map((entry) => (
        <li key={entry.tag} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3">
          <span className="truncate font-mono text-[0.6875rem] text-muted" title={entry.tag}>
            #{entry.tag}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-paper-deep/70">
            <span
              className={cx('block h-full rounded-full bg-accent/70')}
              style={{ width: `${Math.max(4, (entry.count / max) * 100)}%` }}
            />
          </span>
          <span className="font-mono text-[0.6875rem] tabular-nums text-muted">{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}
