'use client';

import { useId, useState } from 'react';
import type { CaptureDraft, CaptureSource } from '@/lib/schemas';
import type { CaptureMeta } from '@/lib/client/api-types';
import { apiPost, errorMessage } from '@/lib/client/api';
import { CLIENT_LIMITS } from '@/lib/client/limits';
import { formatDuration, sourceHost } from '@/lib/client/format';
import { createIdempotencyKey } from '@/lib/client/hooks';
import { useToast } from '@/lib/client/toast';
import { IconDoc, IconLink } from '@/components/icons';
import { KeyPointsEditor, TagsEditor } from '@/components/forms';
import {
  Button,
  Field,
  Input,
  Notice,
  Textarea,
  ThumbFeedback,
  cx,
} from '@/components/ui';

function missingSentence(missing: string[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) return `Add ${missing[0]} to save.`;
  if (missing.length === 2) return `Add ${missing[0]} and ${missing[1]} to save.`;
  return `Add ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]} to save.`;
}

export function DraftEditor({
  initial,
  meta,
  source,
  saving,
  error,
  onSave,
  onDiscard,
}: {
  initial: CaptureDraft;
  meta: CaptureMeta | null;
  source: CaptureSource | null;
  saving: boolean;
  error: string | null;
  onSave: (draft: CaptureDraft) => void;
  onDiscard: () => void;
}) {
  const idPrefix = useId();
  const toast = useToast();
  const [title, setTitle] = useState(typeof initial.title === 'string' ? initial.title : '');
  const [prompt, setPrompt] = useState(
    typeof initial.recall_prompt === 'string' ? initial.recall_prompt : '',
  );
  const [points, setPoints] = useState<string[]>(() => {
    const seeded = Array.isArray(initial.key_points)
      ? initial.key_points.filter((point): point is string => typeof point === 'string')
      : [];
    return seeded.length > 0 ? seeded : [''];
  });
  const [tags, setTags] = useState<string[]>(
    Array.isArray(initial.tags)
      ? initial.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  );
  const [feedbackGiven, setFeedbackGiven] = useState<1 | -1 | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);

  const cleanTitle = title.trim();
  const cleanPrompt = prompt.trim();
  const cleanPoints = points.map((point) => point.trim()).filter((point) => point.length > 0);

  const missing: string[] = [];
  if (cleanTitle.length === 0) missing.push('a title');
  if (cleanPrompt.length < 3) missing.push('a recall prompt');
  if (cleanPoints.length === 0) missing.push('at least one key point');

  const canSave = missing.length === 0 && !saving;

  const rateCapture = async (rating: 1 | -1) => {
    if (!meta?.aiCallId || feedbackPending) return;
    setFeedbackPending(true);
    try {
      await apiPost<{ ok: true }>('/api/ai/feedback', {
        surface: 'capture',
        rating,
        ai_call_id: meta.aiCallId,
        idempotency_key: createIdempotencyKey(),
      });
      setFeedbackGiven(rating);
      toast.success('Thanks — noted.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFeedbackPending(false);
    }
  };

  const submit = () => {
    if (!canSave) return;
    onSave({
      title: cleanTitle.slice(0, CLIENT_LIMITS.titleMaxChars),
      recall_prompt: cleanPrompt.slice(0, CLIENT_LIMITS.recallPromptMaxChars),
      key_points: cleanPoints
        .slice(0, CLIENT_LIMITS.keyPointsMax)
        .map((point) => point.slice(0, CLIENT_LIMITS.keyPointMaxChars)),
      tags: tags.slice(0, CLIENT_LIMITS.tagsMax),
    });
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="Title"
        htmlFor={`${idPrefix}-title`}
        counter={`${title.length} / ${CLIENT_LIMITS.titleMaxChars}`}
      >
        <Input
          id={`${idPrefix}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={CLIENT_LIMITS.titleMaxChars}
          disabled={saving}
          placeholder="A short, specific title"
        />
      </Field>

      <Field
        label="Recall prompt"
        htmlFor={`${idPrefix}-prompt`}
        hint="The question this card asks you later. Keep it to one clear ask."
        counter={`${prompt.length} / ${CLIENT_LIMITS.recallPromptMaxChars}`}
      >
        <Textarea
          id={`${idPrefix}-prompt`}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={CLIENT_LIMITS.recallPromptMaxChars}
          rows={2}
          disabled={saving}
          className="min-h-[4.25rem]"
        />
      </Field>

      <KeyPointsEditor
        value={points}
        onChange={setPoints}
        min={1}
        max={CLIENT_LIMITS.keyPointsMax}
        maxChars={CLIENT_LIMITS.keyPointMaxChars}
        disabled={saving}
        idPrefix={`${idPrefix}-points`}
        label="Key points"
      />

      <TagsEditor
        value={tags}
        onChange={setTags}
        max={CLIENT_LIMITS.tagsMax}
        disabled={saving}
        idPrefix={`${idPrefix}-tags`}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-paper-deep/30 px-3.5 py-3">
        <div className="min-w-0 text-xs leading-relaxed text-muted">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="label-caps">Source</span>
            {source?.kind === 'url' ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="focus-ring inline-flex max-w-full items-center gap-1 rounded text-accent underline-offset-2 hover:underline"
                title={source.url}
              >
                <IconLink size={12} />
                <span className="truncate">{sourceHost(source.url)}</span>
              </a>
            ) : source?.kind === 'text' ? (
              <span className="inline-flex items-center gap-1">
                <IconDoc size={12} />
                Pasted text
              </span>
            ) : (
              <span>Written manually</span>
            )}
          </div>
          {meta ? (
            <p className="mt-1">
              Drafted by {meta.provider === 'live' ? 'live AI' : 'offline mock'} · {meta.model} ·{' '}
              {formatDuration(meta.latencyMs)}
              {meta.cached ? ' · cache hit' : ''}
            </p>
          ) : (
            <p className="mt-1">No AI was used for this card.</p>
          )}
        </div>
        {meta?.aiCallId ? (
          <ThumbFeedback
            value={feedbackGiven}
            onRate={(rating) => {
              void rateCapture(rating);
            }}
            disabled={feedbackPending}
            label="Was this draft useful?"
            compact
          />
        ) : null}
      </div>

      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className={cx('max-w-xs text-xs leading-relaxed', missing.length > 0 ? 'text-amber' : 'text-muted')}>
          {missing.length > 0
            ? missingSentence(missing)
            : 'Everything checks out. Saving puts the card on the ladder, due now.'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDiscard} disabled={saving}>
            Start over
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSave}>
            Save to library
          </Button>
        </div>
      </div>
    </form>
  );
}
