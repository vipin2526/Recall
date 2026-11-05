'use client';

import { useEffect, useRef, useState } from 'react';
import type { Rating } from '@/lib/schemas';
import type { GradeResponse, ReviewResponse } from '@/lib/client/api-types';
import { ApiError, apiPost, errorMessage, isAbortError } from '@/lib/client/api';
import { CLIENT_LIMITS } from '@/lib/client/limits';
import {
  formatAnswerCount,
  formatDue,
  formatInterval,
  formatShortDate,
  pluralize,
} from '@/lib/client/format';
import { useSession } from '@/lib/client/session';
import { useToast } from '@/lib/client/toast';
import { createIdempotencyKey } from '@/lib/client/hooks';
import type { Notebox } from '@/lib/db/types';
import type { ReviewRequest } from '@/lib/schemas';
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconSparkle,
} from '@/components/icons';
import {
  Badge,
  Button,
  Notice,
  RatingPill,
  SegmentedControl,
  StepBadge,
  TagChip,
  Textarea,
  ThumbFeedback,
  cx,
  type SegmentedOption,
} from '@/components/ui';

const VERDICT_OPTIONS: ReadonlyArray<SegmentedOption<Rating>> = [
  { value: 'forgot', label: 'Forgot', tone: 'danger' },
  { value: 'partial', label: 'Partial', tone: 'amber' },
  { value: 'remembered', label: 'Remembered', tone: 'accent' },
];

export function ReviewCard({
  card,
  position,
  total,
  onNext,
}: {
  card: Notebox;
  position: number;
  total: number;
  onNext: (saved: boolean) => void;
}) {
  const { session, reload: reloadSession } = useSession();
  const toast = useToast();

  const [answer, setAnswer] = useState('');
  const [showKeyPoints, setShowKeyPoints] = useState(false);
  const [phase, setPhase] = useState<'answering' | 'grading' | 'saving'>('answering');
  const [grade, setGrade] = useState<GradeResponse | null>(null);
  const [selfMode, setSelfMode] = useState(false);
  const [verdict, setVerdict] = useState<Rating | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ReviewResponse['review'] | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<1 | -1 | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);

  const idempotencyKey = useRef(createIdempotencyKey()).current;
  const gradeController = useRef<AbortController | null>(null);
  const advancedRef = useRef(false);
  const leaveRef = useRef<(saved: boolean) => void>(() => undefined);
  leaveRef.current = (saved) => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    onNext(saved);
  };

  useEffect(() => {
    return () => {
      gradeController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => leaveRef.current(true), 2600);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const answerLength = answer.trim().length;
  const aiGradeEnabled = session.user.aiGrading && session.user.remainingToday > 0;
  const gradeResult = grade?.result ?? null;
  const tags = Array.isArray(card.tags) ? card.tags : [];
  const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
  const missingPoints = Array.isArray(gradeResult?.missing_points) ? gradeResult.missing_points : [];
  const isGrading = phase === 'grading';
  const isSaving = phase === 'saving';

  const aiHint = !session.user.aiGrading
    ? 'AI grading is off in desk settings. Self-grading always works.'
    : session.user.remainingToday <= 0
      ? "You've used today's AI calls. Self-grading always works."
      : answerLength === 0
        ? 'Write a short answer from memory to use AI grading.'
        : null;

  const startSelf = () => {
    gradeController.current?.abort();
    setSelfMode(true);
    setGradeError(null);
    setShowKeyPoints(true);
    setPhase('answering');
  };

  const gradeWithAi = async () => {
    if (isGrading || phase === 'saving' || answerLength === 0) return;
    if (!aiGradeEnabled) return;

    const controller = new AbortController();
    gradeController.current = controller;
    setPhase('grading');
    setGradeError(null);
    setSaveError(null);

    try {
      const response = await apiPost<GradeResponse>('/api/grade', {
        notebox_id: card.id,
        answer: answer.trim(),
      });
      if (controller.signal.aborted) return;

      setGrade(response);
      if (response.result) {
        setVerdict(response.result.verdict);
        setSelfMode(false);
        setShowKeyPoints(true);
      } else {
        setSelfMode(true);
        setGradeError(response.error ?? 'The AI could not grade this one. Grade yourself below.');
        setShowKeyPoints(true);
      }
      void reloadSession();
    } catch (error) {
      if (isAbortError(error)) return;
      if (error instanceof ApiError && error.status === 429) {
        toast.error(error.message);
      }
      setSelfMode(true);
      setShowKeyPoints(true);
      setGradeError(errorMessage(error));
    } finally {
      if (gradeController.current === controller) gradeController.current = null;
      if (!controller.signal.aborted) setPhase('answering');
    }
  };

  const editAnswer = () => {
    gradeController.current?.abort();
    setGrade(null);
    setVerdict(null);
    setSelfMode(false);
    setGradeError(null);
    setSaveError(null);
    setFeedbackGiven(null);
    setPhase('answering');
  };

  const rateGrade = async (rating: 1 | -1) => {
    if (feedbackPending) return;
    setFeedbackPending(true);
    try {
      await apiPost<{ ok: true }>('/api/ai/feedback', {
        surface: 'grade',
        rating,
        notebox_id: card.id,
        ai_call_id: grade?.aiCallId ?? undefined,
        idempotency_key: createIdempotencyKey(),
      });
      setFeedbackGiven(rating);
      toast.success('Thanks — noted.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setFeedbackPending(false);
    }
  };

  const saveReview = async () => {
    if (!verdict || isSaving || saved) return;
    setPhase('saving');
    setSaveError(null);

    const payload: ReviewRequest = {
      notebox_id: card.id,
      rating: verdict,
      ai_used: Boolean(gradeResult),
      idempotency_key: idempotencyKey,
    };
    if (gradeResult) {
      payload.verdict = gradeResult.verdict;
      payload.feedback = gradeResult.feedback;
    }
    if (answerLength > 0) payload.answer = answer.trim();

    try {
      const response = await apiPost<ReviewResponse>('/api/reviews', payload);
      setSaved(response.review);
      setPhase('answering');
      toast.success(response.duplicate ? 'That review was already saved.' : 'Review saved.');
      void reloadSession();
    } catch (error) {
      setPhase('answering');
      setSaveError(errorMessage(error));
      toast.error(errorMessage(error));
    }
  };

  const skip = () => {
    gradeController.current?.abort();
    toast.info('Skipped — the card stays due.');
    leaveRef.current(false);
  };

  const showVerdictPanel = Boolean(gradeResult) || selfMode;

  return (
    <article className="card-surface animate-rise p-5 sm:p-7" aria-labelledby="review-card-title">
      <p className="sr-only" role="status">
        {isGrading
          ? 'AI is reading your answer.'
          : saved
            ? `Review saved. Next review in ${formatInterval(saved.intervalDays)}.`
            : ''}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <StepBadge step={card.step} />
        <span className="font-mono text-[0.6875rem] text-muted">{formatDue(card.dueAt)}</span>
        {tags.map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
      </div>

      <h1 id="review-card-title" className="mt-3 text-balance font-display text-2xl leading-snug text-ink sm:text-[1.75rem]">
        {card.title}
      </h1>

      <div className="mt-5 border-l-2 border-accent/45 pl-4">
        <p className="label-caps">Recall prompt</p>
        <p className="mt-1.5 text-balance font-display text-xl leading-relaxed text-ink sm:text-[1.375rem]">
          {card.recallPrompt}
        </p>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowKeyPoints((value) => !value)}
          aria-expanded={showKeyPoints}
          aria-controls="key-points-panel"
          className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          <IconChevronDown
            size={14}
            className={cx('transition-transform duration-200', showKeyPoints && 'rotate-180')}
          />
          {showKeyPoints ? 'Hide key points' : 'Show key points'}
        </button>
        {showKeyPoints ? (
          <ul
            id="key-points-panel"
            className="card-inset mt-2.5 space-y-1.5 px-4 py-3 text-sm leading-relaxed text-ink/90"
          >
            {keyPoints.map((point, index) => (
              <li key={`${card.id}-${index}`} className="flex gap-2.5">
                <span className="mt-0.5 font-mono text-[0.6875rem] text-accent/80">{index + 1}</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {saved ? (
        <div className="mt-6 rounded-xl border border-accent/30 bg-accent-soft/40 p-5 animate-rise" role="status">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white">
              <IconCheck size={18} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-xl text-ink">Review saved</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Next review in{' '}
                <span className="font-medium text-ink">{formatInterval(saved.intervalDays)}</span> —{' '}
                {formatShortDate(saved.dueAt)}.{' '}
                {saved.stepAfter === 0
                  ? 'The ladder resets to step 1.'
                  : `You're on step ${saved.stepAfter} of 6.`}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 pl-12">
            <Button variant="primary" size="sm" onClick={() => leaveRef.current(true)}>
              {position === total ? 'Finish session' : 'Next card'}
              <IconArrowRight size={14} />
            </Button>
            <span className="text-xs text-muted">Moving on in a moment.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="review-answer" className="text-[0.8125rem] font-medium text-ink">
                Your recall
              </label>
              <span className="font-mono text-[0.6875rem] tabular-nums text-muted">
                {formatAnswerCount(answer.length, CLIENT_LIMITS.answerMaxChars)}
              </span>
            </div>
            <Textarea
              id="review-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              maxLength={CLIENT_LIMITS.answerMaxChars}
              rows={5}
              disabled={isGrading || isSaving}
              readOnly={Boolean(gradeResult)}
              placeholder="Write what you remember, in your own words…"
              className="mt-1.5 min-h-[8.5rem]"
              aria-describedby="review-answer-hint"
            />
            <p id="review-answer-hint" className="mt-1.5 text-xs leading-relaxed text-muted">
              Answer first, then check the key points. AI is optional — your own grade is enough.
            </p>
          </div>

          {!gradeResult && !selfMode ? (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => {
                    void gradeWithAi();
                  }}
                  loading={isGrading}
                  disabled={!aiGradeEnabled || answerLength === 0 || isSaving}
                >
                  {!isGrading ? <IconSparkle size={15} /> : null}
                  {isGrading ? 'Reading your answer…' : 'Grade with AI'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={startSelf}
                  disabled={isGrading || isSaving}
                >
                  Grade myself
                </Button>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={skip} disabled={isSaving}>
                  Skip for now
                </Button>
              </div>
              {aiHint ? <p className="mt-2 text-xs leading-relaxed text-muted">{aiHint}</p> : null}
            </div>
          ) : null}

          {gradeError ? (
            <Notice tone="warning" className="mt-4" role="status">
              {gradeError} You can still grade yourself below.
            </Notice>
          ) : null}

          {gradeResult ? (
            <section
              className="mt-5 rounded-xl border border-line bg-paper-soft/60 p-4 animate-rise"
              aria-label="AI grading suggestion"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label-caps">AI suggestion</span>
                  <Badge tone={grade?.provider === 'live' ? 'accent' : 'amber'}>
                    {grade?.provider === 'live' ? 'Live' : grade?.provider === 'mock' ? 'Mock' : 'Offline'}
                  </Badge>
                  {grade?.model ? (
                    <span className="font-mono text-[0.625rem] text-muted/80">{grade.model}</span>
                  ) : null}
                </div>
                <ThumbFeedback
                  value={feedbackGiven}
                  onRate={(rating) => {
                    void rateGrade(rating);
                  }}
                  disabled={feedbackPending}
                  label="Was this AI verdict useful?"
                  compact
                />
              </div>

              <div className="mt-3">
                <RatingPill rating={gradeResult.verdict} />
              </div>

              {missingPoints.length > 0 ? (
                <div className="mt-3">
                  <p className="label-caps">Still missing</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm leading-relaxed text-muted">
                    {missingPoints.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="mt-3 text-sm leading-relaxed text-ink/90">{gradeResult.feedback}</p>

              <p className="mt-3 border-t border-line/70 pt-2.5 text-xs leading-relaxed text-muted">
                The AI read this as {gradeResult.verdict}. You decide the final rating — the verdict
                below is editable, and the ladder follows your choice.
              </p>
            </section>
          ) : null}

          {showVerdictPanel ? (
            <section className="mt-5 rounded-xl border border-line p-4" aria-label="Your verdict">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-lg text-ink">
                  {gradeResult ? 'Your verdict' : 'Grade yourself'}
                </p>
                {gradeResult ? (
                  <button
                    type="button"
                    onClick={editAnswer}
                    className="focus-ring rounded text-xs font-medium text-accent underline-offset-2 hover:underline"
                  >
                    Edit answer
                  </button>
                ) : (
                  <span className="text-xs text-muted">
                    {pluralize(answerLength, 'character')} recalled
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                This is what moves the ladder. Partial counts as {session.user.partialCountsAs}.
              </p>
              <SegmentedControl<Rating>
                label="Your verdict"
                value={verdict}
                onChange={setVerdict}
                options={VERDICT_OPTIONS}
                size="md"
                fullWidth
                className="mt-3"
                disabled={isSaving}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  {saveError ? (
                    <p className="text-xs text-danger" role="alert">
                      {saveError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">No AI is required to save a review.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!gradeResult ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelfMode(false);
                        setVerdict(null);
                        setGradeError(null);
                      }}
                      disabled={isSaving}
                    >
                      Use AI instead
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    onClick={() => {
                      void saveReview();
                    }}
                    loading={isSaving}
                    disabled={!verdict || isGrading}
                  >
                    Save review
                  </Button>
                </div>
              </div>
            </section>
          ) : null}
        </>
      )}
    </article>
  );
}
