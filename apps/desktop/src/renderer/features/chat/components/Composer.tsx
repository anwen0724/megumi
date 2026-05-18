import { FormEvent, KeyboardEvent, useId, useState } from 'react';
import {
  AtSign,
  Bot,
  Brain,
  Clock3,
  LoaderCircle,
  Paperclip,
  SendHorizontal,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { Badge, Button, IconButton, cx } from '../../../shared/ui';
import {
  COMPOSER_MODE_OPTIONS,
  COMPOSER_MODEL_OPTIONS,
  type ComposerMode,
  type ComposerModel,
} from './composer-options';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ComposerSubmitPayload {
  message: string;
  mode: ComposerMode;
  model: ComposerModel;
}

interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
  onShowApproval?: () => void;
}

const statusConfig = {
  idle: null,
  sending: {
    label: 'Sending',
    variant: 'accent',
    icon: LoaderCircle,
  },
  running: {
    label: 'Megumi is working',
    variant: 'accent',
    icon: Sparkles,
  },
  'waiting-approval': {
    label: 'Waiting for approval',
    variant: 'approval',
    icon: Clock3,
  },
  error: {
    label: 'Needs attention',
    variant: 'danger',
    icon: TriangleAlert,
  },
} as const;

export function Composer({
  status = 'idle',
  initialValue = '',
  onSubmit,
  onStop,
  onChooseContext,
  onAttachFiles,
  onShowApproval,
}: ComposerProps) {
  const modeId = useId();
  const modelId = useId();
  const [value, setValue] = useState(initialValue);
  const [mode, setMode] = useState<ComposerMode>('chat');
  const [model, setModel] = useState<ComposerModel>('deepseek-v4-flash');
  const trimmedValue = value.trim();
  const inputLocked = status === 'waiting-approval';
  const sendLocked = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canSend = trimmedValue.length > 0 && !sendLocked;
  const canStop = status === 'sending' || status === 'running';
  const activeStatus = statusConfig[status];
  const StatusIcon = activeStatus?.icon;

  function submitDraft() {
    if (!canSend) return;

    onSubmit({
      message: trimmedValue,
      mode,
      model,
    });
    setValue('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function insertNewlineAtCursor(textarea: HTMLTextAreaElement) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    setValue(`${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') {
      return;
    }

    const isComposing = event.nativeEvent.isComposing || (event as unknown as { isComposing?: boolean }).isComposing;

    if (isComposing || event.shiftKey) {
      return;
    }

    if (event.altKey) {
      event.preventDefault();
      insertNewlineAtCursor(event.currentTarget);
      return;
    }

    event.preventDefault();
    submitDraft();
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl px-6 pb-6">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 shadow-[var(--shadow-soft)]">
        <label htmlFor="megumi-composer" className="sr-only">
          Message Megumi
        </label>
        <textarea
          id="megumi-composer"
          value={value}
          disabled={inputLocked}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="Ask Megumi anything..."
          rows={3}
          className="min-h-20 w-full resize-none border-0 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)] disabled:cursor-not-allowed disabled:opacity-70"
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <IconButton label="Attach files" variant="ghost" size="sm" onClick={onAttachFiles}>
              <Paperclip size={16} aria-hidden="true" />
            </IconButton>
            <Button type="button" variant="ghost" size="sm" onClick={onChooseContext}>
              <AtSign size={15} aria-hidden="true" />
              Choose context
            </Button>

            <label htmlFor={modeId} className="sr-only">
              Composer mode
            </label>
            <div className="flex h-8 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-muted)]">
              <Bot size={14} aria-hidden="true" />
              <select
                id={modeId}
                aria-label="Composer mode"
                value={mode}
                disabled={inputLocked}
                onChange={(event) => setMode(event.target.value as ComposerMode)}
                className="bg-transparent text-xs text-[var(--color-text)] outline-none disabled:cursor-not-allowed"
              >
                {COMPOSER_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <label htmlFor={modelId} className="sr-only">
              Model
            </label>
            <div className="flex h-8 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-muted)]">
              <Brain size={14} aria-hidden="true" />
              <select
                id={modelId}
                aria-label="Model"
                value={model}
                disabled={inputLocked}
                onChange={(event) => setModel(event.target.value as ComposerModel)}
                className="bg-transparent text-xs text-[var(--color-text)] outline-none disabled:cursor-not-allowed"
              >
                {COMPOSER_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {activeStatus && StatusIcon ? (
              <Badge variant={activeStatus.variant} className={cx(status === 'sending' ? 'animate-pulse' : undefined)}>
                <StatusIcon size={12} aria-hidden="true" />
                {activeStatus.label}
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {status === 'waiting-approval' ? (
              <Button type="button" variant="secondary" size="sm" onClick={onShowApproval}>
                Review approval
              </Button>
            ) : null}
            {canStop ? (
              <Button type="button" variant="primary" size="sm" onClick={onStop} aria-label="Stop current run">
                <Square size={13} aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="sm" disabled={!canSend} aria-label="Send message">
                <SendHorizontal size={15} aria-hidden="true" />
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
