'use client';

import { useEffect, useId, useState } from 'react';
import type { CardDetailResponse } from '@/lib/client/api-types';
import { apiDelete, apiGet, apiPatch, errorMessage, isAbortError } from '@/lib/client/api';
import { CLIENT_LIMITS } from '@/lib/client/limits';
import {
  formatDateTime,
  formatDue,
  formatInterval,
  formatShortDate,
  pluralize,
  sourceHost,
} from '@/lib/client/format';
import { useToast } from '@/lib/client/toast';
import {
  IconArrowUpRight,
  IconPause,
  IconPen,
  IconPlay,
  IconTrash,
} from '@/components/icons';
import { ConfirmDialog, Dialog } from '@/components/dialog';
import { KeyPointsEditor, TagsEditor } from '@/components/forms';
import {
  Badge,
  Button,
  Field,
  Input,
  Notice,
  RatingPill,
  SectionLabel,
  Skeleton,
  StepBadge,
  TagChip,
  Textarea,
  cx,
} from '@/components/ui';
import type { Notebox } from '@/lib/db/types';

export function CardDetail({
  cardId,
  onClose,
  onChanged,
  onDeleted,
}: {
  cardId: string;
  onClose: () => void;
  onChanged: (notebox: Notebox) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const fieldId = useId();

  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editPoints, setEditPoints] = useState<string[]>(['']);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [suspendPending, setSuspendPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    apiGet<CardDetailResponse>(`/api/cards/${encodeURIComponent(cardId)}`, controller.signal)
      .then((data) => {
        if (!active) return;
        setDetail(data);
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
  }, [cardId, reloadToken]);

  const notebox = detail?.notebox ?? null;
  const reviews = Array.isArray(detail?.reviews) ? detail.reviews.slice(0, 20) : [];
  const keyPoints = Array.isArray(notebox?.keyPoints) ? notebox.keyPoints : [];
  const tags = Array.isArray(notebox?.tags) ? notebox.tags : [];
  const suspended = notebox?.suspended ?? false;
  const busy = savingEdit || suspendPending || deletePending;

  const beginEdit = () => {
    if (!notebox) return;
    setEditTitle(typeof notebox.title === 'string' ? notebox.title : '');
    setEditPrompt(typeof notebox.recallPrompt === 'string' ? notebox.recallPrompt : '');
    setEditPoints(keyPoints.length > 0 ? keyPoints : ['']);
    setEditTags(tags);
    setEditError(null);
    setEditing(true);
  };

  const cleanTitle = editTitle.trim();
  const cleanPrompt = editPrompt.trim();
  const cleanPoints = editPoints.map((point) => point.trim()).filter(Boolean);
  const editValid = cleanTitle.length > 0 && cleanPrompt.length >= 3 && cleanPoints.length > 0;

  const saveEdit = async () => {
    if (!notebox || !editValid || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const response = await apiPatch<{ notebox: Notebox }>(
        `/api/cards/${encodeURIComponent(notebox.id)}`,
        {
          title: cleanTitle.slice(0, CLIENT_LIMITS.titleMaxChars),
          recall_prompt: cleanPrompt.slice(0, CLIENT_LIMITS.recallPromptMaxChars),
          key_points: cleanPoints
            .slice(0, CLIENT_LIMITS.keyPointsMax)
            .map((point) => point.slice(0, CLIENT_LIMITS.keyPointMaxChars)),
          tags: editTags.slice(0, CLIENT_LIMITS.tagsMax),
        },
      );
      setDetail((current) => (current ? { ...current, notebox: response.notebox } : current));
      onChanged(response.notebox);
      setEditing(false);
      toast.success('Card updated.');
    } catch (err) {
      const message = errorMessage(err);
      setEditError(message);
      toast.error(message);
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleSuspend = async () => {
    if (!notebox || suspendPending) return;
    setSuspendPending(true);
    try {
      const response = await apiPatch<{ notebox: Notebox }>(
        `/api/cards/${encodeURIComponent(notebox.id)}`,
        { suspended: !notebox.suspended },
      );
      setDetail((current) => (current ? { ...current, notebox: response.notebox } : current));
      onChanged(response.notebox);
      toast.success(response.notebox.suspended ? 'Card suspended.' : 'Card back in rotation.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSuspendPending(false);
    }
  };

  const deleteCard = async () => {
    if (!notebox || deletePending) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await apiDelete<{ ok: true }>(`/api/cards/${encodeURIComponent(notebox.id)}`);
      toast.success('Card deleted.');
      onDeleted(notebox.id);
      setConfirmDelete(false);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <>
      <Dialog
        open
        onClose={() => {
          if (!busy && !confirmDelete) onClose();
        }}
        title={editing ? 'Edit card' : (notebox?.title ?? 'Card detail')}
        description={
          notebox
            ? `${notebox.step > 0 ? `Step ${notebox.step}` : 'New card'} · ${formatDue(notebox.dueAt)}${suspended ? ' · suspended' : ''}`
            : loading
              ? 'Loading card…'
              : undefined
        }
        size="lg"
        closeOnEscape={!confirmDelete && !busy}
      >
        {loading ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <div className="py-6 text-center">
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
        ) : notebox ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StepBadge step={notebox.step} />
                <span className="font-mono text-[0.6875rem] text-muted">
                  {formatDue(notebox.dueAt)}
                </span>
                {suspended ? <Badge tone="amber">Suspended</Badge> : null}
              </div>
              {!editing ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={beginEdit} disabled={busy}>
                    <IconPen size={14} />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void toggleSuspend();
                    }}
                    loading={suspendPending}
                    disabled={busy}
                  >
                    {suspended ? <IconPlay size={14} /> : <IconPause size={14} />}
                    {suspended ? 'Resume' : 'Suspend'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmDelete(true);
                    }}
                    disabled={busy}
                  >
                    <IconTrash size={14} />
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>

            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <TagChip key={tag} tag={tag} />
                ))}
              </div>
            ) : null}

            {editing ? (
              <div className="space-y-4">
                <Field
                  label="Title"
                  htmlFor={`${fieldId}-title`}
                  counter={`${editTitle.length} / ${CLIENT_LIMITS.titleMaxChars}`}
                >
                  <Input
                    id={`${fieldId}-title`}
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    maxLength={CLIENT_LIMITS.titleMaxChars}
                    disabled={savingEdit}
                  />
                </Field>
                <Field
                  label="Recall prompt"
                  htmlFor={`${fieldId}-prompt`}
                  counter={`${editPrompt.length} / ${CLIENT_LIMITS.recallPromptMaxChars}`}
                >
                  <Textarea
                    id={`${fieldId}-prompt`}
                    value={editPrompt}
                    onChange={(event) => setEditPrompt(event.target.value)}
                    maxLength={CLIENT_LIMITS.recallPromptMaxChars}
                    rows={2}
                    disabled={savingEdit}
                    className="min-h-[4.25rem]"
                  />
                </Field>
                <KeyPointsEditor
                  value={editPoints}
                  onChange={setEditPoints}
                  min={1}
                  max={CLIENT_LIMITS.keyPointsMax}
                  maxChars={CLIENT_LIMITS.keyPointMaxChars}
                  disabled={savingEdit}
                  idPrefix={`${fieldId}-points`}
                />
                <TagsEditor
                  value={editTags}
                  onChange={setEditTags}
                  max={CLIENT_LIMITS.tagsMax}
                  disabled={savingEdit}
                  idPrefix={`${fieldId}-tags`}
                />
                {editError ? (
                  <Notice tone="error" role="alert">
                    {editError}
                  </Notice>
                ) : null}
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setEditError(null);
                    }}
                    disabled={savingEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      void saveEdit();
                    }}
                    loading={savingEdit}
                    disabled={!editValid}
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <SectionLabel>Recall prompt</SectionLabel>
                  <p className="mt-2 border-l-2 border-accent/40 pl-4 font-display text-lg leading-relaxed text-ink">
                    {notebox.recallPrompt}
                  </p>
                </div>

                <div>
                  <SectionLabel
                    action={
                      <span className="font-mono text-[0.6875rem] text-muted">
                        {pluralize(keyPoints.length, 'point')}
                      </span>
                    }
                  >
                    Key points
                  </SectionLabel>
                  <ol className="mt-2 space-y-2">
                    {keyPoints.map((point, index) => (
                      <li
                        key={`${notebox.id}-point-${index}`}
                        className="flex gap-2.5 rounded-lg bg-paper-deep/25 px-3 py-2 text-sm leading-relaxed text-ink/90"
                      >
                        <span className="mt-0.5 font-mono text-[0.6875rem] text-accent/80">
                          {index + 1}
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {notebox.sourceUrl ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="label-caps">Source</span>
                    <a
                      href={notebox.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring inline-flex min-w-0 items-center gap-1 rounded text-accent underline-offset-2 hover:underline"
                    >
                      <span className="truncate">{sourceHost(notebox.sourceUrl)}</span>
                      <IconArrowUpRight size={12} className="shrink-0" />
                    </a>
                  </div>
                ) : null}

                <div className="border-t border-line pt-4">
                  <SectionLabel
                    action={
                      <span className="font-mono text-[0.6875rem] text-muted">
                        {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
                      </span>
                    }
                  >
                    Recent reviews
                  </SectionLabel>
                  {reviews.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      No reviews yet. This card has not been on the desk.
                    </p>
                  ) : (
                    <ul className="mt-1 divide-y divide-line/70">
                      {reviews.map((review) => (
                        <li key={review.id} className="py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <RatingPill rating={review.rating} />
                            {review.aiUsed ? <Badge tone="outline">AI read</Badge> : null}
                            {review.verdict && review.verdict !== review.rating ? (
                              <span className="text-[0.6875rem] text-muted">
                                AI suggested {review.verdict}
                              </span>
                            ) : null}
                            <span className="ml-auto font-mono text-[0.6875rem] text-muted">
                              {formatDateTime(review.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            Next in {formatInterval(review.intervalDays)} · step {review.stepAfter}
                          </p>
                          {review.feedback ? (
                            <p className="mt-1 border-l border-line pl-2 text-xs italic leading-relaxed text-muted">
                              “{review.feedback}”
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[0.6875rem] text-muted">
                  <span>Added {formatShortDate(notebox.createdAt)}</span>
                  <span className={cx('font-mono', suspended && 'text-amber')}>
                    {suspended ? 'Paused — no reviews scheduled' : 'Active on the ladder'}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => {
          if (!deletePending) setConfirmDelete(false);
        }}
        onConfirm={() => {
          void deleteCard();
        }}
        title="Delete this card?"
        body={
          <>
            “{notebox?.title ?? 'This card'}” and its review history will be removed from your
            library. This cannot be undone.
          </>
        }
        confirmLabel="Delete card"
        pending={deletePending}
        error={deleteError}
      />
    </>
  );
}
