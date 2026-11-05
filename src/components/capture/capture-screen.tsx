'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { CaptureDraft, CaptureSource, CreateNoteboxInput } from '@/lib/schemas';
import type { CaptureEvent, CaptureMeta, CreateCardResponse } from '@/lib/client/api-types';
import {
  apiPost,
  apiStream,
  errorMessage,
  isAbortError,
  readSseStream,
} from '@/lib/client/api';
import { CLIENT_LIMITS } from '@/lib/client/limits';
import { sourceHost } from '@/lib/client/format';
import { createIdempotencyKey } from '@/lib/client/hooks';
import { useSession } from '@/lib/client/session';
import { useToast } from '@/lib/client/toast';
import { IconArrowRight, IconCheck, IconDoc, IconLink, IconSparkle } from '@/components/icons';
import {
  Button,
  Field,
  Input,
  Notice,
  PageHeader,
  SegmentedControl,
  Textarea,
  buttonStyles,
} from '@/components/ui';
import type { Notebox } from '@/lib/db/types';
import { CaptureTimeline, initialSteps, isTimelineStepId } from './capture-timeline';
import type { TimelineCue, TimelineStep } from './capture-timeline';
import { DraftEditor } from './draft-editor';

type Phase = 'compose' | 'streaming' | 'draft' | 'error' | 'saved' | 'manual';
type Mode = 'url' | 'text';

function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function describeSource(source: CaptureSource | null): string {
  if (!source) return '';
  if (source.kind === 'url') return sourceHost(source.url);
  return source.title ? `Pasted text — ${source.title}` : 'Pasted text';
}

const EMPTY_DRAFT: CaptureDraft = {
  title: '',
  recall_prompt: '',
  key_points: [''],
  tags: [],
};

export function CaptureScreen() {
  const { session, reload: reloadSession } = useSession();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');

  const [phase, setPhase] = useState<Phase>('compose');
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [cues, setCues] = useState<TimelineCue[]>([]);
  const [liveMessage, setLiveMessage] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);

  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [meta, setMeta] = useState<CaptureMeta | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [submittedSource, setSubmittedSource] = useState<CaptureSource | null>(null);

  const [cardKey, setCardKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCard, setSavedCard] = useState<{ notebox: Notebox; duplicate: boolean } | null>(null);

  const streamRef = useRef<AbortController | null>(null);
  const saveGuard = useRef(false);

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
    };
  }, []);

  const trimmedUrl = url.trim();
  const urlValid = isValidHttpUrl(trimmedUrl);
  const textLength = text.trim().length;
  const textValid = textLength >= 40 && text.length <= CLIENT_LIMITS.sourceTextMaxChars;
  const canSubmit = mode === 'url' ? urlValid : textValid;

  const applyStatus = (step: string, message: string) => {
    setLiveMessage(message);
    if (step === 'retry' || step === 'cached' || step === 'fallback') {
      setCues((current) => {
        if (current.some((cue) => cue.kind === step && cue.message === message)) return current;
        return [...current, { kind: step, message }];
      });
      return;
    }
    if (!isTimelineStepId(step)) {
      setCues((current) => [...current, { kind: 'note', message }]);
      return;
    }
    setSteps((current) => {
      const target = current.findIndex((item) => item.id === step);
      if (target === -1) return current;
      return current.map((item, index) => {
        if (index < target) {
          return item.state === 'error' ? item : { ...item, state: 'done' };
        }
        if (index === target) {
          return { ...item, state: 'active', message };
        }
        return item;
      });
    });
  };

  const markActiveError = (message: string) => {
    setSteps((current) => {
      const active = current.findIndex((item) => item.state === 'active');
      const fallback = current.findIndex((item) => item.state === 'pending');
      const index = active >= 0 ? active : fallback;
      if (index < 0) return current;
      return current.map((item, i) =>
        i === index ? { ...item, state: 'error', message } : item,
      );
    });
  };

  const startCapture = async () => {
    if (streamRef.current || !canSubmit) return;

    const source: CaptureSource =
      mode === 'url'
        ? { kind: 'url', url: trimmedUrl }
        : {
            kind: 'text',
            text: text.trim(),
            ...(title.trim() ? { title: title.trim() } : {}),
          };

    const key = createIdempotencyKey();
    setCardKey(key);
    setSubmittedSource(source);
    setDraft(null);
    setMeta(null);
    setSavedCard(null);
    setSaveError(null);
    setStreamError(null);
    setCues([]);
    setSteps(initialSteps(mode));
    setLiveMessage('Starting capture…');
    setPhase('streaming');

    const controller = new AbortController();
    streamRef.current = controller;

    try {
      const response = await apiStream(
        '/api/capture',
        { source, idempotency_key: key },
        controller.signal,
      );

      let receivedDraft = false;
      let receivedError = false;

      await readSseStream<CaptureEvent>(
        response,
        (event) => {
          if (controller.signal.aborted) return;
          if (event.type === 'status') {
            if (typeof event.step === 'string' && typeof event.message === 'string') {
              applyStatus(event.step, event.message);
            }
          } else if (event.type === 'draft') {
            if (event.draft && typeof event.draft === 'object') {
              receivedDraft = true;
              setDraft(event.draft);
              setMeta(event.meta && typeof event.meta === 'object' ? event.meta : null);
              setDraftKey((value) => value + 1);
              setSteps((current) => current.map((item) => ({ ...item, state: 'done' })));
              setPhase('draft');
              setLiveMessage('Draft ready. Review it before saving.');
            }
          } else {
            const message =
              typeof event.message === 'string' && event.message.trim().length > 0
                ? event.message
                : 'The capture failed. Try again, or add the card manually.';
            receivedError = true;
            setStreamError(message);
            setPhase('error');
            markActiveError(message);
            setLiveMessage(message);
          }
        },
        controller.signal,
      );

      if (controller.signal.aborted) return;

      if (!receivedDraft && !receivedError) {
        const message = 'The capture ended before a draft was ready. Try again, or add the card manually.';
        setStreamError(message);
        setPhase('error');
        markActiveError(message);
        setLiveMessage(message);
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      const message = errorMessage(error);
      setStreamError(message);
      setPhase('error');
      markActiveError(message);
      setLiveMessage(message);
    } finally {
      if (streamRef.current === controller) streamRef.current = null;
    }
  };

  const cancelStream = () => {
    streamRef.current?.abort();
    streamRef.current = null;
    setPhase('compose');
    setLiveMessage('');
    toast.info('Capture cancelled. Nothing was saved.');
  };

  const reset = (clearSource: boolean) => {
    streamRef.current?.abort();
    streamRef.current = null;
    setPhase('compose');
    setDraft(null);
    setMeta(null);
    setSubmittedSource(null);
    setSteps([]);
    setCues([]);
    setStreamError(null);
    setSaveError(null);
    setSavedCard(null);
    setLiveMessage('');
    if (clearSource) {
      setUrl('');
      setText('');
      setTitle('');
    }
  };

  const startManual = () => {
    streamRef.current?.abort();
    streamRef.current = null;
    setPhase('manual');
    setDraft({ ...EMPTY_DRAFT, key_points: [''] });
    setMeta(null);
    setSubmittedSource(null);
    setCardKey(createIdempotencyKey());
    setDraftKey((value) => value + 1);
    setSaveError(null);
    setStreamError(null);
    setSavedCard(null);
    setLiveMessage('');
  };

  const saveDraft = async (next: CaptureDraft) => {
    if (saving || saveGuard.current) return;
    const key = cardKey || createIdempotencyKey();
    if (!cardKey) setCardKey(key);

    saveGuard.current = true;
    setSaving(true);
    setSaveError(null);

    const payload: CreateNoteboxInput = {
      title: next.title,
      key_points: next.key_points,
      recall_prompt: next.recall_prompt,
      tags: next.tags,
      idempotency_key: key,
      ...(submittedSource?.kind === 'url' ? { source_url: submittedSource.url } : {}),
    };

    try {
      const response = await apiPost<CreateCardResponse>('/api/cards', payload);
      const duplicate = Boolean(response.duplicate || response.idempotentReplay);
      setSavedCard({ notebox: response.notebox, duplicate });
      setPhase('saved');
      toast.success(duplicate ? 'Already in your library — opened the existing card.' : 'Card saved.');
      void reloadSession();
    } catch (error) {
      const message = errorMessage(error);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
      saveGuard.current = false;
    }
  };

  const mockMode = session.ai.mode === 'mock';
  const noAiCalls = session.user.remainingToday <= 0;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Capture"
        title="Turn a note into recall"
        description="Paste a link or some text. AI drafts the card; you approve every word before it saves."
        actions={
          <Link href="/library" className={buttonStyles('secondary', 'md')}>
            Library
          </Link>
        }
      />

      <p className="sr-only" role="status">
        {liveMessage}
      </p>

      {phase === 'compose' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <section className="card-surface animate-rise p-5 sm:p-6" aria-label="Capture a source">
            <SegmentedControl<Mode>
              label="Capture source"
              value={mode}
              onChange={setMode}
              size="md"
              options={[
                {
                  value: 'url',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <IconLink size={13} />
                      URL
                    </span>
                  ),
                },
                {
                  value: 'text',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <IconDoc size={13} />
                      Paste text
                    </span>
                  ),
                },
              ]}
            />

            {mode === 'url' ? (
              <div className="mt-5">
                <Field
                  label="Article URL"
                  htmlFor="capture-url"
                  hint="We fetch the page and extract the readable article — no paywall workarounds."
                  error={
                    trimmedUrl.length > 0 && !urlValid
                      ? 'Enter a full http:// or https:// address.'
                      : undefined
                  }
                >
                  <Input
                    id="capture-url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://example.com/an-essay"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    maxLength={2048}
                    invalid={trimmedUrl.length > 0 && !urlValid}
                  />
                </Field>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <Field
                  label="Title"
                  htmlFor="capture-text-title"
                  optional
                  counter={`${title.length} / ${CLIENT_LIMITS.titleMaxChars}`}
                  hint="Used as context for the draft; you can edit the card later."
                >
                  <Input
                    id="capture-text-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={CLIENT_LIMITS.titleMaxChars}
                    placeholder="What is this note about?"
                  />
                </Field>
                <Field
                  label="Text"
                  htmlFor="capture-text"
                  hint="At least 40 characters. The AI reads only what you paste."
                  counter={`${text.length.toLocaleString('en-US')} / ${CLIENT_LIMITS.sourceTextMaxChars.toLocaleString('en-US')}`}
                  error={
                    text.length > 0 && textLength < 40
                      ? 'Add a little more text — 40 characters minimum.'
                      : undefined
                  }
                >
                  <Textarea
                    id="capture-text"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={CLIENT_LIMITS.sourceTextMaxChars}
                    rows={10}
                    placeholder="Paste a note, an excerpt, or your own explanation…"
                    className="min-h-[12rem]"
                  />
                </Field>
              </div>
            )}

            {mockMode ? (
              <Notice tone="info" className="mt-4">
                Offline mock mode: drafts come from a deterministic local fixture. Edits work the
                same way.
              </Notice>
            ) : null}

            {noAiCalls ? (
              <Notice tone="warning" className="mt-4">
                You have used today's AI calls. Capture may still hit a cached draft.{' '}
                <button
                  type="button"
                  onClick={startManual}
                  className="focus-ring rounded font-medium underline underline-offset-2"
                >
                  Write a card manually
                </button>
                .
              </Notice>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="max-w-xs text-xs leading-relaxed text-muted">
                AI drafts; nothing is saved until you approve. The schedule never depends on it.
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  void startCapture();
                }}
                disabled={!canSubmit}
              >
                <IconSparkle size={16} />
                Draft my cards
              </Button>
            </div>
          </section>

          <aside className="card-surface p-5" aria-label="How capture works">
            <p className="label-caps">What happens</p>
            <ol className="mt-3 space-y-3">
              <li className="flex gap-2.5">
                <span className="font-mono text-[0.6875rem] text-accent/80">01</span>
                <div>
                  <p className="text-sm font-medium text-ink">Fetch & extract</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    For a URL, the readable article is pulled out — no AI yet.
                  </p>
                </div>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-[0.6875rem] text-accent/80">02</span>
                <div>
                  <p className="text-sm font-medium text-ink">Draft</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    A narrow agent writes a title, a recall prompt and 3–5 key points.
                  </p>
                </div>
              </li>
              <li className="flex gap-2.5">
                <span className="font-mono text-[0.6875rem] text-accent/80">03</span>
                <div>
                  <p className="text-sm font-medium text-ink">You approve</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">
                    Edit anything, then save. The card is due now and joins the 1/3/7 ladder.
                  </p>
                </div>
              </li>
            </ol>
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-sm font-medium text-ink">Prefer plain text?</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Skip the agent and write the card yourself.
              </p>
              <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={startManual}>
                Write a card manually
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      {phase === 'streaming' ? (
        <section className="card-surface mx-auto max-w-2xl animate-rise p-6 sm:p-7" aria-busy="true">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label-caps">Capture agent</p>
              <h2 className="mt-2 text-balance font-display text-2xl text-ink">
                Drafting your card
              </h2>
              <p className="mt-1 truncate text-sm text-muted">{describeSource(submittedSource)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={cancelStream}>
              Cancel
            </Button>
          </div>
          <div className="mt-6">
            <CaptureTimeline steps={steps} cues={cues} />
          </div>
        </section>
      ) : null}

      {phase === 'error' ? (
        <div className="mx-auto max-w-2xl space-y-4">
          <section className="card-surface animate-rise p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label-caps">Capture agent</p>
                <h2 className="mt-2 font-display text-2xl text-ink">That capture stopped early</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => reset(false)}>
                Start over
              </Button>
            </div>
            <div className="mt-5">
              <CaptureTimeline steps={steps} cues={cues} error />
            </div>
            <Notice tone="error" className="mt-4">
              {streamError ?? 'The capture could not finish. Try again or write the card yourself.'}
            </Notice>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  void startCapture();
                }}
                disabled={!canSubmit}
              >
                Try again
              </Button>
              <Button variant="secondary" onClick={startManual}>
                Add manually
              </Button>
              <Link href="/today" className={buttonStyles('ghost', 'md', 'ml-auto')}>
                Back to today
              </Link>
            </div>
          </section>
        </div>
      ) : null}

      {phase === 'draft' && draft ? (
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="label-caps">Draft ready</p>
              <h2 className="mt-1 font-display text-2xl text-ink">
                Check it before it becomes a card
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => reset(false)} disabled={saving}>
              Start over
            </Button>
          </div>
          <div className="card-surface mt-4 animate-rise p-5 sm:p-6">
            <DraftEditor
              key={draftKey}
              initial={draft}
              meta={meta}
              source={submittedSource}
              saving={saving}
              error={saveError}
              onSave={(next) => {
                void saveDraft(next);
              }}
              onDiscard={() => reset(false)}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Your edits win over the AI draft. The card is due as soon as you save it.
          </p>
        </div>
      ) : null}

      {phase === 'manual' && draft ? (
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="label-caps">Manual</p>
              <h2 className="mt-1 font-display text-2xl text-ink">Write a card yourself</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => reset(false)} disabled={saving}>
              Start over
            </Button>
          </div>
          <Notice tone="info" className="mt-4">
            The capture agent did not run. You control every field; the card still lands on the same
            plain-code ladder.
          </Notice>
          <div className="card-surface mt-4 animate-rise p-5 sm:p-6">
            <DraftEditor
              key={`manual-${draftKey}`}
              initial={draft}
              meta={null}
              source={null}
              saving={saving}
              error={saveError}
              onSave={(next) => {
                void saveDraft(next);
              }}
              onDiscard={() => reset(false)}
            />
          </div>
        </div>
      ) : null}

      {phase === 'saved' && savedCard ? (
        <div className="mx-auto max-w-xl">
          <section className="card-surface animate-rise p-7 text-center sm:p-8" role="status">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-white">
              <IconCheck size={22} />
            </span>
            <p className="label-caps mt-4">Saved to library</p>
            <h2 className="mt-2 text-balance font-display text-2xl text-ink">
              {savedCard.notebox.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Due now. The ladder takes it from here — the first interval is one day.
            </p>
            {savedCard.duplicate ? (
              <Notice tone="info" className="mt-4 text-left">
                This card was already in your library, so the existing one was kept — your review
                history is intact.
              </Notice>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Link
                href={`/review?card=${encodeURIComponent(savedCard.notebox.id)}`}
                className={buttonStyles('primary', 'md')}
              >
                Review it now
                <IconArrowRight size={15} />
              </Link>
              <Button variant="secondary" onClick={() => reset(true)}>
                Capture another
              </Button>
            </div>
            <div className="mt-4">
              <Link
                href="/library"
                className="focus-ring rounded text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Open library
              </Link>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
