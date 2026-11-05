'use client';

import { useId, useState } from 'react';
import { IconPlus, IconX } from '@/components/icons';
import { Button, Field, IconButton, Input, TagChip, Textarea, cx } from '@/components/ui';
import { CLIENT_LIMITS } from '@/lib/client/limits';

export function KeyPointsEditor({
  value,
  onChange,
  min = 1,
  max = CLIENT_LIMITS.keyPointsMax,
  maxChars = CLIENT_LIMITS.keyPointMaxChars,
  disabled = false,
  idPrefix,
  label = 'Key points',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  min?: number;
  max?: number;
  maxChars?: number;
  disabled?: boolean;
  idPrefix: string;
  label?: string;
}) {
  const hintId = useId();
  const update = (index: number, next: string) => {
    onChange(value.map((point, i) => (i === index ? next : point)));
  };
  const remove = (index: number) => {
    if (value.length <= min) return;
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2" role="group" aria-label={label}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-ink">{label}</p>
        <span className="font-mono text-[0.6875rem] text-muted">
          {value.length} / {max}
        </span>
      </div>
      {value.map((point, index) => (
        <div key={index} className="flex items-start gap-2">
          <span
            className="mt-2.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-paper-deep/70 font-mono text-[0.6875rem] text-muted"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${idPrefix}-point-${index}`} className="sr-only">
              {label} {index + 1}
            </label>
            <Textarea
              id={`${idPrefix}-point-${index}`}
              value={point}
              onChange={(event) => update(index, event.target.value)}
              maxLength={maxChars}
              rows={2}
              disabled={disabled}
              placeholder={index === 0 ? 'The single idea this card protects' : 'Another point worth recalling'}
              className="min-h-[3.25rem] resize-y py-2 text-sm"
            />
          </div>
          <IconButton
            label={`Remove point ${index + 1}`}
            onClick={() => remove(index)}
            disabled={disabled || value.length <= min}
            className="mt-1.5"
          >
            <IconX size={14} />
          </IconButton>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 pl-8">
        <p id={hintId} className="text-xs leading-relaxed text-muted">
          Keep each point short — one idea you want to retrieve later.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...value, ''])}
          disabled={disabled || value.length >= max}
          className="shrink-0"
        >
          <IconPlus size={13} />
          Add point
        </Button>
      </div>
    </div>
  );
}

function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, CLIENT_LIMITS.tagMaxChars);
}

export function TagsEditor({
  value,
  onChange,
  max = CLIENT_LIMITS.tagsMax,
  disabled = false,
  idPrefix,
  label = 'Tags',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  disabled?: boolean;
  idPrefix: string;
  label?: string;
}) {
  const [draft, setDraft] = useState('');
  const atLimit = value.length >= max;

  const add = () => {
    const tag = normalizeTag(draft);
    if (!tag || atLimit) return;
    if (value.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  };

  return (
    <Field
      label={label}
      htmlFor={`${idPrefix}-tag-input`}
      optional={value.length === 0}
      counter={`${value.length} / ${max}`}
      hint={`Up to ${max} tags, ${CLIENT_LIMITS.tagMaxChars} characters each. Press Enter to add.`}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-tag-input`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            maxLength={CLIENT_LIMITS.tagMaxChars}
            placeholder={atLimit ? 'Tag limit reached' : 'e.g. systems-thinking'}
            disabled={disabled || atLimit}
            className="h-9 py-1.5 text-sm"
            autoComplete="off"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={add}
            disabled={disabled || atLimit || draft.trim().length === 0}
            className="h-9 shrink-0"
          >
            Add
          </Button>
        </div>
        {value.length > 0 ? (
          <div className={cx('flex flex-wrap gap-1.5')}>
            {value.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                onRemove={
                  disabled
                    ? undefined
                    : () => onChange(value.filter((existing) => existing !== tag))
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </Field>
  );
}
