'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SessionInfo } from '@/lib/db/types';
import type { PartialBehavior } from '@/lib/scheduler';
import { apiGet, apiPatch, errorMessage, setUnauthorizedHandler } from './api';
import { Button } from '@/components/ui';

export interface SessionSettingsPatch {
  partialCountsAs?: PartialBehavior;
  aiGrading?: boolean;
}

interface SessionContextValue {
  session: SessionInfo;
  reload: () => Promise<void>;
  updateSettings: (patch: SessionSettingsPatch) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function SessionSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-16" aria-busy="true">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full border border-line bg-paper-soft font-display text-xl text-ink">
            R
          </span>
          <div>
            <p className="font-display text-xl text-ink">Recall</p>
            <p className="label-caps mt-0.5">Spaced recall desk</p>
          </div>
        </div>
        <p className="mt-10 text-sm text-muted" role="status">
          Preparing your desk…
        </p>
        <div className="mt-4 space-y-3">
          <div className="h-3 w-2/3 animate-pulse rounded-full bg-paper-deep" />
          <div className="h-3 w-1/2 animate-pulse rounded-full bg-paper-deep/80" />
          <div className="h-3 w-3/5 animate-pulse rounded-full bg-paper-deep/60" />
        </div>
      </div>
    </div>
  );
}

function SessionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="card-surface w-full max-w-md p-7 text-center">
        <p className="label-caps">Connection</p>
        <h1 className="mt-2 font-display text-2xl text-ink">We could not reach your session</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{message}</p>
        <Button variant="primary" className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const applySession = useCallback((next: SessionInfo) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const reload = useCallback(async () => {
    if (inFlight.current) return inFlight.current;

    if (!sessionRef.current) {
      setLoading(true);
      setError(null);
    }

    const run = (async () => {
      try {
        const next = await apiGet<SessionInfo>('/api/session');
        applySession(next);
        setError(null);
      } catch (err) {
        if (!sessionRef.current) setError(errorMessage(err));
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();

    inFlight.current = run;
    return run;
  }, [applySession]);

  useEffect(() => {
    void reload();
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [reload]);

  useEffect(() => {
    setUnauthorizedHandler(reload);
    return () => setUnauthorizedHandler(null);
  }, [reload]);

  const updateSettings = useCallback(
    async (patch: SessionSettingsPatch) => {
      const body: { partial_counts_as?: PartialBehavior; ai_grading?: boolean } = {};
      if (patch.partialCountsAs !== undefined) body.partial_counts_as = patch.partialCountsAs;
      if (patch.aiGrading !== undefined) body.ai_grading = patch.aiGrading;

      const data = await apiPatch<{ user: SessionInfo['user'] }>('/api/session', body);
      const current = sessionRef.current;
      if (current) applySession({ ...current, user: data.user });
    },
    [applySession],
  );

  const value = useMemo<SessionContextValue | null>(() => {
    if (!session) return null;
    return { session, reload, updateSettings };
  }, [session, reload, updateSettings]);

  if (loading && !session) return <SessionSkeleton />;
  if (error && !session) {
    return (
      <SessionError
        message={error}
        onRetry={() => {
          void reload();
        }}
      />
    );
  }
  if (!value) return <SessionSkeleton />;

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
