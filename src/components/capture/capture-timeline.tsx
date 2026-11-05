'use client';

import { IconCheck, IconLoader, IconX } from '@/components/icons';
import { Badge, cx } from '@/components/ui';

export type TimelineStepId = 'fetch' | 'extract' | 'generate' | 'validate' | 'save';
export type TimelineState = 'pending' | 'active' | 'done' | 'error';

export interface TimelineStep {
  id: TimelineStepId;
  label: string;
  detail: string;
  state: TimelineState;
  message?: string;
}

export interface TimelineCue {
  kind: 'retry' | 'cached' | 'fallback' | 'note';
  message: string;
}

export const STEP_COPY: Record<TimelineStepId, { label: string; detail: string }> = {
  fetch: { label: 'Fetching the page', detail: 'Retrieving the article over the web' },
  extract: { label: 'Extracting the article', detail: 'Readability pass — no AI yet' },
  generate: { label: 'Drafting the card', detail: 'Narrow AI writes a first pass' },
  validate: { label: 'Checking the draft', detail: 'Shape, lengths and quality rules' },
  save: { label: 'Preparing your draft', detail: 'Nothing is saved until you approve' },
};

export function initialSteps(mode: 'url' | 'text'): TimelineStep[] {
  const ids: TimelineStepId[] =
    mode === 'url' ? ['fetch', 'extract', 'generate', 'validate', 'save'] : ['generate', 'validate', 'save'];
  return ids.map((id) => ({ id, ...STEP_COPY[id], state: 'pending' }));
}

export function isTimelineStepId(value: string): value is TimelineStepId {
  return (
    value === 'fetch' ||
    value === 'extract' ||
    value === 'generate' ||
    value === 'validate' ||
    value === 'save'
  );
}

function StepIcon({ state }: { state: TimelineState }) {
  if (state === 'done') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-accent text-white">
        <IconCheck size={13} />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent">
        <IconLoader size={14} className="animate-spin" />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="flex size-6 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-danger">
        <IconX size={13} />
      </span>
    );
  }
  return <span className="mt-0.5 size-6 rounded-full border border-line bg-paper-soft" aria-hidden="true" />;
}

const CUE_TONE = {
  retry: 'amber',
  cached: 'accent',
  fallback: 'amber',
  note: 'neutral',
} as const;

const CUE_LABEL = {
  retry: 'Retry',
  cached: 'Cache hit',
  fallback: 'Fallback',
  note: 'Note',
} as const;

export function CaptureTimeline({
  steps,
  cues,
  error = false,
}: {
  steps: TimelineStep[];
  cues: TimelineCue[];
  error?: boolean;
}) {
  return (
    <div>
      <ol className="space-y-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepIcon state={step.state} />
                {!isLast ? (
                  <span
                    className={cx(
                      'my-1 w-px flex-1',
                      step.state === 'done' ? 'bg-accent/40' : 'bg-line',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              <div className={cx('min-w-0', isLast ? 'pb-0' : 'pb-4')}>
                <p
                  className={cx(
                    'text-sm leading-6',
                    step.state === 'pending'
                      ? 'text-muted'
                      : step.state === 'error'
                        ? 'font-medium text-danger'
                        : 'font-medium text-ink',
                  )}
                >
                  {step.label}
                </p>
                <p className="text-xs leading-relaxed text-muted">
                  {step.message ?? step.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {cues.length > 0 ? (
        <div className="mt-4 space-y-1.5 border-t border-line/70 pt-3">
          {cues.map((cue, index) => (
            <div key={`${cue.kind}-${index}`} className="flex items-start gap-2 text-xs text-muted">
              <Badge tone={CUE_TONE[cue.kind]} className="mt-px shrink-0">
                {CUE_LABEL[cue.kind]}
              </Badge>
              <span className="leading-relaxed">{cue.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Nothing was saved. You can retry, or write the card yourself.
        </p>
      ) : null}
    </div>
  );
}
