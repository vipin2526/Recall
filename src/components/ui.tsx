import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import type { Rating } from '@/lib/schemas';
import { IconAlert, IconCheck, IconInfo, IconThumbsDown, IconThumbsUp } from '@/components/icons';
import { cx } from './cx';

export { cx };

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'focus-ring inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[0.625rem] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_10px_20px_-16px_rgba(15,118,110,0.9)] hover:bg-accent-deep active:bg-[#0a504a]',
  secondary:
    'border border-line bg-paper-soft/80 text-ink hover:border-[#c9bfae] hover:bg-paper-soft active:bg-paper-deep/70',
  ghost: 'text-muted hover:bg-paper-deep/60 hover:text-ink',
  quiet: 'bg-paper-deep/60 text-ink hover:bg-paper-deep',
  danger: 'bg-danger text-white hover:bg-danger-deep active:bg-[#7f1d1d]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[0.9375rem]',
};

export function buttonStyles(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  extra?: string,
): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra);
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  'data-autofocus'?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 13 : 15} /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export function IconButton({ label, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-paper-deep/70 hover:text-ink disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'amber' | 'danger' | 'outline';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-paper-deep/50 text-muted',
  accent: 'border-accent/25 bg-accent-soft/80 text-accent-deep',
  amber: 'border-amber/25 bg-amber-soft/70 text-amber',
  danger: 'border-danger/25 bg-danger/10 text-danger',
  outline: 'border-line bg-transparent text-muted',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium leading-5',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StepBadge({ step, className }: { step: number; className?: string }) {
  return (
    <Badge
      tone={step > 0 ? 'accent' : 'neutral'}
      className={cx('font-mono tracking-tight', className)}
      title={step > 0 ? `Ladder step ${step} of 6` : 'New card, not yet on the ladder'}
    >
      {step > 0 ? `Step ${step}` : 'New'}
    </Badge>
  );
}

export function TagChip({
  tag,
  onRemove,
  className,
}: {
  tag: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border border-line/80 bg-paper-soft/70 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-5 text-muted',
        className,
      )}
    >
      #{tag}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="focus-ring -mr-0.5 rounded-sm p-0.5 text-muted/70 transition-colors hover:text-danger"
          aria-label={`Remove tag ${tag}`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

export type SegmentTone = 'neutral' | 'accent' | 'amber' | 'danger';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: string;
  disabled?: boolean;
  tone?: SegmentTone;
}

interface SegmentedControlProps<T extends string> {
  value: T | null;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  className?: string;
}

const SEGMENT_SELECTED: Record<SegmentTone, string> = {
  neutral: 'bg-paper-soft text-ink shadow-sm ring-1 ring-line',
  accent: 'bg-accent-soft text-accent-deep shadow-sm ring-1 ring-accent/25',
  amber: 'bg-amber-soft text-amber shadow-sm ring-1 ring-amber/25',
  danger: 'bg-danger/10 text-danger shadow-sm ring-1 ring-danger/20',
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  size = 'md',
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        'inline-flex items-center gap-0.5 rounded-xl border border-line bg-paper-deep/40 p-1',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            title={option.hint}
            className={cx(
              'focus-ring flex-1 rounded-lg font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-40',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              selected ? SEGMENT_SELECTED[option.tone ?? 'neutral'] : 'text-muted hover:text-ink',
              !fullWidth && 'flex-none',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  counter,
  children,
  className,
  optional = false,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  counter?: ReactNode;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cx('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink">
          {label}
          {optional ? <span className="ml-1.5 font-normal text-muted">optional</span> : null}
        </label>
        {counter ? (
          <span className="font-mono text-[0.6875rem] tabular-nums text-muted">{counter}</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cx('field', className)}
      aria-invalid={invalid || rest['aria-invalid'] === 'true' ? 'true' : undefined}
      {...rest}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cx('field', className)}
      aria-invalid={invalid || rest['aria-invalid'] === 'true' ? 'true' : undefined}
      {...rest}
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx('animate-rise', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
          {eyebrow ? <p className="label-caps">{eyebrow}</p> : null}
          <h1 className="mt-2 text-balance font-display text-[2rem] leading-[1.1] text-ink sm:text-[2.5rem]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionLabel({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4', className)}>
      <h2 className="label-caps">{children}</h2>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('card-surface p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="label-caps">{label}</p>
        {icon ? <span className="text-muted/70">{icon}</span> : null}
      </div>
      <p className="mt-3 font-display text-[1.75rem] leading-none text-ink">{value}</p>
      {hint ? <p className="mt-2 text-xs leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'card-surface flex flex-col items-center px-6 text-center',
        compact ? 'py-8' : 'py-14',
        className,
      )}
    >
      {icon ? (
        <span className="flex size-12 items-center justify-center rounded-full border border-line bg-paper-soft text-accent">
          {icon}
        </span>
      ) : null}
      <h2 className="mt-4 text-balance font-display text-xl text-ink">{title}</h2>
      {body ? (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const NOTICE_TONES: Record<NoticeTone, { box: string; icon: ReactNode }> = {
  info: {
    box: 'border-line bg-paper-deep/35 text-muted',
    icon: <IconInfo size={16} className="text-muted" />,
  },
  success: {
    box: 'border-accent/25 bg-accent-soft/40 text-accent-deep',
    icon: <IconCheck size={16} className="text-accent" />,
  },
  warning: {
    box: 'border-amber/25 bg-amber-soft/50 text-[#7c3d06]',
    icon: <IconAlert size={16} className="text-amber" />,
  },
  error: {
    box: 'border-danger/25 bg-danger/10 text-danger',
    icon: <IconAlert size={16} className="text-danger" />,
  },
};

export function Notice({
  tone = 'info',
  children,
  className,
  role,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  const style = NOTICE_TONES[tone];
  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : undefined)}
      className={cx(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed',
        style.box,
        className,
      )}
    >
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 [&_a]:underline [&_a]:underline-offset-2">{children}</div>
    </div>
  );
}

export function Meter({
  value,
  max,
  label,
  tone = 'accent',
  className,
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'accent' | 'amber';
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(1, Math.max(0, value / safeMax));
  return (
    <div
      className={cx('h-1.5 overflow-hidden rounded-full bg-paper-deep', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-300 ease-out',
          tone === 'accent' ? 'bg-accent' : 'bg-amber',
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export function ThumbFeedback({
  value,
  onRate,
  disabled = false,
  label = 'Was this helpful?',
  className,
  compact = false,
}: {
  value: 1 | -1 | null;
  onRate: (rating: 1 | -1) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cx('inline-flex items-center gap-1.5', className)} role="group" aria-label={label}>
      {!compact ? <span className="label-caps">Feedback</span> : null}
      <button
        type="button"
        onClick={() => onRate(1)}
        disabled={disabled}
        aria-pressed={value === 1}
        aria-label="Helpful"
        title="Helpful"
        className={cx(
          'focus-ring inline-flex size-7 items-center justify-center rounded-md border transition-colors duration-150 disabled:opacity-40',
          value === 1
            ? 'border-accent/30 bg-accent-soft text-accent'
            : 'border-line bg-paper-soft/60 text-muted hover:text-ink',
        )}
      >
        <IconThumbsUp size={13} />
      </button>
      <button
        type="button"
        onClick={() => onRate(-1)}
        disabled={disabled}
        aria-pressed={value === -1}
        aria-label="Not helpful"
        title="Not helpful"
        className={cx(
          'focus-ring inline-flex size-7 items-center justify-center rounded-md border transition-colors duration-150 disabled:opacity-40',
          value === -1
            ? 'border-danger/30 bg-danger/10 text-danger'
            : 'border-line bg-paper-soft/60 text-muted hover:text-ink',
        )}
      >
        <IconThumbsDown size={13} />
      </button>
    </div>
  );
}

const RATING_TONE: Record<Rating, BadgeTone> = {
  remembered: 'accent',
  partial: 'amber',
  forgot: 'danger',
};

const RATING_LABEL: Record<Rating, string> = {
  remembered: 'Remembered',
  partial: 'Partial',
  forgot: 'Forgot',
};

export function RatingPill({ rating, className }: { rating: Rating; className?: string }) {
  return (
    <Badge tone={RATING_TONE[rating]} className={className}>
      <span
        className={cx(
          'size-1.5 rounded-full',
          rating === 'remembered' ? 'bg-accent' : rating === 'partial' ? 'bg-amber' : 'bg-danger',
        )}
        aria-hidden="true"
      />
      {RATING_LABEL[rating]}
    </Badge>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-paper-deep/75', className)} aria-hidden="true" />;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full bg-line', className)} aria-hidden="true" />;
}
