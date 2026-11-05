'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  IconBook,
  IconChart,
  IconLayers,
  IconPen,
  IconPulse,
  IconSettings,
  IconSun,
  IconX,
} from '@/components/icons';
import {
  IconButton,
  Meter,
  SegmentedControl,
  Skeleton,
  buttonStyles,
  cx,
} from '@/components/ui';
import type { IconProps } from '@/components/icons';
import type { PartialBehavior } from '@/lib/scheduler';
import { errorMessage } from '@/lib/client/api';
import { useSession } from '@/lib/client/session';
import { useToast } from '@/lib/client/toast';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/today', label: 'Today', icon: IconSun, shortcut: 't' },
  { href: '/capture', label: 'Capture', icon: IconPen, shortcut: 'c' },
  { href: '/library', label: 'Library', icon: IconBook, shortcut: 'l' },
  { href: '/insights', label: 'Insights', icon: IconChart, shortcut: 'i' },
  { href: '/monitor', label: 'Monitor', icon: IconPulse, shortcut: 'm' },
];

const SHORTCUT_ROUTES: Record<string, string> = {
  t: '/today',
  c: '/capture',
  l: '/library',
  i: '/insights',
  m: '/monitor',
  r: '/review',
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/today"
      className="focus-ring flex items-center gap-2.5 rounded-lg"
      aria-label="Recall, go to Today"
    >
      <span
        className={cx(
          'flex items-center justify-center rounded-full border border-ink/10 bg-paper-soft font-display text-ink shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]',
          compact ? 'size-8 text-base' : 'size-9 text-lg',
        )}
      >
        R
      </span>
      <span className="leading-tight">
        <span className={cx('block font-display text-ink', compact ? 'text-lg' : 'text-[1.3rem]')}>
          Recall
        </span>
        {!compact ? <span className="label-caps mt-1 block text-[0.5625rem]">Spaced desk</span> : null}
      </span>
    </Link>
  );
}

function AiModeBadge({ mode, model, className }: { mode: 'live' | 'mock'; model: string; className?: string }) {
  return (
    <span
      title={`AI: ${mode === 'live' ? 'live' : 'offline mock'} · ${model}`}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium leading-none',
        mode === 'live'
          ? 'border-accent/25 bg-accent-soft/70 text-accent-deep'
          : 'border-amber/30 bg-amber-soft/60 text-amber',
        className,
      )}
    >
      <span
        className={cx('size-1.5 rounded-full', mode === 'live' ? 'bg-accent' : 'bg-amber')}
        aria-hidden="true"
      />
      {mode === 'live' ? 'Live' : 'Offline mock'}
    </span>
  );
}

function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'focus-ring flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-150 disabled:opacity-50',
        checked ? 'justify-end border-accent bg-accent' : 'justify-start border-line bg-paper-deep',
      )}
    >
      <span className="size-[1.125rem] rounded-full bg-white shadow-sm" />
    </button>
  );
}

function SettingsPopover({ trigger }: { trigger: 'rail' | 'icon' }) {
  const { session, updateSettings } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<'partial' | 'grading' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const changePartial = async (next: PartialBehavior) => {
    if (saving || next === session.user.partialCountsAs) return;
    setSaving('partial');
    try {
      await updateSettings({ partialCountsAs: next });
      toast.success(
        next === 'remembered'
          ? 'Partial answers now count as remembered.'
          : 'Partial answers now count as forgot.',
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  const changeGrading = async (next: boolean) => {
    if (saving) return;
    setSaving('grading');
    try {
      await updateSettings({ aiGrading: next });
      toast.success(next ? 'AI grading is on.' : 'AI grading is off. Self-grading stays available.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      {trigger === 'rail' ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className={cx(
            'focus-ring flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-paper-soft/70 px-2.5 text-xs font-medium text-ink transition-colors hover:bg-paper-soft',
            open && 'bg-paper-soft',
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <IconSettings size={15} className="text-muted" />
            Desk settings
          </span>
          <IconSettings size={13} className="text-muted/60" />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label="Desk settings"
          className="focus-ring inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-paper-deep/70 hover:text-ink"
        >
          <IconSettings size={18} />
        </button>
      )}

      {open ? (
        <div
          id={panelId}
          aria-label="Desk settings"
          className={cx(
            'card-surface absolute z-50 w-[19rem] p-4 animate-rise',
            trigger === 'rail' ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2',
          )}
        >
          <div className="flex items-center justify-between">
            <p className="label-caps">Preferences</p>
            <IconButton
              label="Close settings"
              className="-mr-1.5 -mt-1.5 size-8"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <IconX size={14} />
            </IconButton>
          </div>

          <div className="mt-3">
            <p className="text-[0.8125rem] font-medium text-ink">Partial answers count as</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              A ladder rule, not an AI decision.
            </p>
            <SegmentedControl<PartialBehavior>
              label="Partial answers count as"
              value={session.user.partialCountsAs}
              onChange={(value) => {
                void changePartial(value);
              }}
              disabled={saving !== null}
              size="sm"
              fullWidth
              className="mt-2"
              options={[
                { value: 'forgot', label: 'Forgot', tone: 'danger' },
                { value: 'remembered', label: 'Remembered', tone: 'accent' },
              ]}
            />
          </div>

          <div className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-4">
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-medium text-ink">AI grading</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                Suggests a verdict; you always override it.
              </p>
            </div>
            {saving === 'grading' ? (
              <Skeleton className="h-6 w-11 rounded-full" />
            ) : (
              <Switch
                checked={session.user.aiGrading}
                onChange={(next) => {
                  void changeGrading(next);
                }}
                label="AI grading"
                disabled={saving !== null}
              />
            )}
          </div>

          <p className="mt-4 border-t border-line pt-3 text-[0.6875rem] leading-relaxed text-muted">
            The interval ladder is plain code. AI never moves your schedule.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RailNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-3">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'focus-ring group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
              active
                ? 'bg-paper-soft text-ink shadow-[0_1px_0_rgba(29,26,21,0.03)] ring-1 ring-line/80'
                : 'text-muted hover:bg-paper-soft/60 hover:text-ink',
            )}
          >
            <span
              className={cx(
                'absolute inset-y-2 left-0 w-[2px] rounded-full bg-accent transition-opacity',
                active ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden="true"
            />
            <Icon size={17} className={active ? 'text-accent' : 'text-muted/80'} />
            <span className={cx('flex-1', active && 'font-medium')}>{item.label}</span>
            <kbd className="hidden rounded border border-line/70 bg-paper/60 px-1 py-0.5 font-mono text-[0.5625rem] text-muted/70 group-hover:inline">
              g {item.shortcut}
            </kbd>
          </Link>
        );
      })}
    </nav>
  );
}

function UsageMeter() {
  const { session } = useSession();
  const { dailyAiLimit, usedToday, remainingToday } = session.user;
  return (
    <div className="rounded-xl border border-line bg-paper-soft/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps">AI today</span>
        <span className="font-mono text-[0.6875rem] tabular-nums text-ink">
          {remainingToday} / {dailyAiLimit} left
        </span>
      </div>
      <Meter
        value={usedToday}
        max={dailyAiLimit}
        label="AI calls used today"
        tone={remainingToday === 0 ? 'amber' : 'accent'}
        className="mt-2"
      />
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-muted">
        Capture and grading share this budget.
      </p>
    </div>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Primary" className="no-scrollbar overflow-x-auto px-3 pb-2">
      <div className="flex w-max min-w-full items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors duration-150',
                active
                  ? 'bg-accent-soft/80 font-medium text-accent-deep'
                  : 'text-muted hover:bg-paper-deep/50 hover:text-ink',
              )}
            >
              <Icon size={15} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/today';
  const router = useRouter();
  const { session } = useSession();

  useEffect(() => {
    let waitingForG = false;
    let timer: number | undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if (waitingForG) {
        const destination = SHORTCUT_ROUTES[event.key.toLowerCase()];
        waitingForG = false;
        if (timer !== undefined) window.clearTimeout(timer);
        if (destination) {
          event.preventDefault();
          router.push(destination);
        }
        return;
      }

      if (event.key.toLowerCase() === 'g') {
        waitingForG = true;
        timer = window.setTimeout(() => {
          waitingForG = false;
        }, 1200);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [router]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-paper"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-paper/80 backdrop-blur-sm lg:flex">
        <div className="px-5 pb-6 pt-7">
          <Brand />
        </div>
        <RailNav pathname={pathname} />
        <div className="space-y-3 border-t border-line px-4 py-4">
          <UsageMeter />
          <div className="flex items-center justify-between gap-2">
            <AiModeBadge mode={session.ai.mode} model={session.ai.model} />
            <span className="truncate font-mono text-[0.5625rem] text-muted/70" title={session.ai.model}>
              {session.ai.model}
            </span>
          </div>
          <SettingsPopover trigger="rail" />
          <p className="text-[0.625rem] leading-relaxed text-muted/80">
            Keyboard: press <kbd className="font-mono text-ink/70">g</kbd> then{' '}
            <kbd className="font-mono text-ink/70">t</kbd> <kbd className="font-mono text-ink/70">c</kbd>{' '}
            <kbd className="font-mono text-ink/70">l</kbd> <kbd className="font-mono text-ink/70">i</kbd>{' '}
            <kbd className="font-mono text-ink/70">m</kbd>.
          </p>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-sm lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <Brand compact />
            <div className="flex items-center gap-1.5">
              <AiModeBadge mode={session.ai.mode} model={session.ai.model} />
              <SettingsPopover trigger="icon" />
            </div>
          </div>
          <MobileNav pathname={pathname} />
        </header>

        <main id="main" className="animate-fade mx-auto w-full max-w-5xl px-4 pb-20 pt-7 sm:px-6 lg:px-10 lg:pt-12">
          {children}
        </main>

        <footer className="mx-auto hidden w-full max-w-5xl items-center justify-between gap-4 px-10 pb-8 text-[0.6875rem] text-muted/70 sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <IconLayers size={13} />
            Recall — narrow AI, plain-code scheduling
          </span>
          <Link href="/monitor" className={buttonStyles('ghost', 'sm', 'h-7 px-2 text-[0.6875rem]')}>
            AI operations
          </Link>
        </footer>
      </div>
    </div>
  );
}
