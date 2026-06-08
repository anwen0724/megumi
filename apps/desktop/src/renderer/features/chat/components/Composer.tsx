import { FormEvent, KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  AtSign,
  Bot,
  Brain,
  Paperclip,
  SendHorizontal,
  Square,
} from 'lucide-react';
import type { PermissionModeSelectionSource } from '@megumi/shared/permission-mode-contracts';
import type { WorkflowCommandMetadata } from '@megumi/shared/workflow-command-contracts';
import { Button, IconButton } from '../../../shared/ui';
import {
  COMPOSER_MODEL_OPTIONS,
  COMPOSER_PERMISSION_MODE_OPTIONS,
  type ComposerModel,
  type ComposerPermissionMode,
} from './composer-options';
import {
  createWorkflowCommandSubmitPayload,
  listWorkflowCommandSuggestions,
  type CommandDefinition,
} from '../../workflow-commands';

export type ComposerStatus = 'idle' | 'sending' | 'running' | 'waiting-approval' | 'error';

export interface ComposerSubmitPayload {
  message: string;
  permissionMode: ComposerPermissionMode;
  permissionSource?: PermissionModeSelectionSource;
  model: ComposerModel;
  workflow?: WorkflowCommandMetadata;
}

interface ComposerProps {
  status?: ComposerStatus;
  initialValue?: string;
  seedTextKey?: string | null;
  seedText?: string | null;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
}

const COMPOSER_TEXTAREA_COMPACT_HEIGHT = 56;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 160;

function createComposerSubmitPayload(input: {
  message: string;
  permissionMode: ComposerPermissionMode;
  model: ComposerModel;
}): ComposerSubmitPayload {
  const workflowPayload = createWorkflowCommandSubmitPayload(input.message);

  if (workflowPayload) {
    return {
      ...workflowPayload,
      model: input.model,
    };
  }

  return {
    message: input.message,
    permissionMode: input.permissionMode,
    model: input.model,
  };
}

export function Composer({
  status = 'idle',
  initialValue = '',
  seedTextKey = null,
  seedText = null,
  onSubmit,
  onStop,
  onChooseContext,
  onAttachFiles,
}: ComposerProps) {
  const permissionModeId = useId();
  const modelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(initialValue);
  const [permissionMode, setPermissionMode] = useState<ComposerPermissionMode>('default');
  const [model, setModel] = useState<ComposerModel>('deepseek-v4-flash');
  const [commandSelectionIndex, setCommandSelectionIndex] = useState(0);
  const [commandAutocompleteDismissedFor, setCommandAutocompleteDismissedFor] = useState<string | null>(null);
  const trimmedValue = value.trim();
  const inputLocked = status === 'waiting-approval';
  const sendLocked = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canSend = trimmedValue.length > 0 && !sendLocked;
  const showStop = status === 'sending' || status === 'running';
  const canStop = showStop && Boolean(onStop);
  const placeholder = 'Ask Megumi anything...';
  const commandSuggestions = listWorkflowCommandSuggestions(value);
  const showCommandAutocomplete =
    commandSuggestions.length > 0 &&
    commandAutocompleteDismissedFor !== value &&
    !inputLocked;
  const selectedCommand = showCommandAutocomplete
    ? commandSuggestions[Math.min(commandSelectionIndex, commandSuggestions.length - 1)]
    : undefined;

  useEffect(() => {
    if (seedTextKey && seedText !== null && seedText !== undefined) {
      setValue(seedText);
    }
  }, [seedTextKey, seedText]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = `${COMPOSER_TEXTAREA_COMPACT_HEIGHT}px`;

    const scrollHeight = textarea.scrollHeight;
    const nextHeight = value
      ? Math.max(COMPOSER_TEXTAREA_COMPACT_HEIGHT, Math.min(scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT))
      : COMPOSER_TEXTAREA_COMPACT_HEIGHT;

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    setCommandSelectionIndex(0);
    setCommandAutocompleteDismissedFor(null);
  }, [value]);

  function completeCommand(command: CommandDefinition) {
    setValue(`/${command.name} `);
    setCommandAutocompleteDismissedFor(`/${command.name} `);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }

  function submitDraft() {
    if (!canSend) return;

    onSubmit(createComposerSubmitPayload({
      message: trimmedValue,
      permissionMode,
      model,
    }));
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
    if (showCommandAutocomplete) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCommandSelectionIndex((current) => Math.min(current + 1, commandSuggestions.length - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCommandSelectionIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && selectedCommand) {
        event.preventDefault();
        completeCommand(selectedCommand);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setCommandAutocompleteDismissedFor(value);
        return;
      }
    }

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
    <form
      aria-label="Message composer"
      onSubmit={handleSubmit}
      className="pointer-events-auto mx-auto w-full transition-[width,transform,opacity] duration-200 ease-out"
    >
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)] transition-shadow duration-150">
        <div data-testid="composer-input-panel" className="border-b border-[var(--color-border)] px-4 py-3">
          <label htmlFor="megumi-composer" className="sr-only">
            Message Megumi
          </label>
          <textarea
            ref={textareaRef}
            id="megumi-composer"
            value={value}
            disabled={inputLocked}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={placeholder}
            rows={2}
            className="max-h-40 min-h-14 w-full resize-none border-0 bg-transparent text-sm leading-5 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)] disabled:cursor-not-allowed disabled:opacity-70"
          />
          {showCommandAutocomplete ? (
            <div
              role="listbox"
              aria-label="Command suggestions"
              className="mt-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]"
            >
              {commandSuggestions.map((command, index) => (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  aria-selected={index === commandSelectionIndex}
                  aria-label={`/${command.name} ${command.description}`}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] aria-selected:bg-[var(--color-surface-hover)]"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => completeCommand(command)}
                >
                  <span className="shrink-0 font-mono text-[var(--color-text)]">{`/${command.name}`}</span>
                  <span className="min-w-0 truncate text-xs text-[var(--color-text-muted)]">{command.description}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div data-testid="composer-toolbar" className="flex min-h-12 flex-nowrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton label="Attach files" variant="ghost" size="sm" className="shrink-0" onClick={onAttachFiles}>
              <Paperclip size={16} aria-hidden="true" />
            </IconButton>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={onChooseContext}
              aria-label="Choose context"
            >
              <AtSign size={15} aria-hidden="true" />
              Context
            </Button>
          </div>

          <div data-testid="composer-actions" className="flex min-w-0 shrink-0 items-center justify-end gap-2">
            <div className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-muted)]">
              <label htmlFor={permissionModeId} className="sr-only">
                Permission mode
              </label>
              <Bot size={14} aria-hidden="true" />
              <select
                id={permissionModeId}
                aria-label="Permission mode"
                value={permissionMode}
                disabled={inputLocked}
                onChange={(event) => setPermissionMode(event.target.value as ComposerPermissionMode)}
                className="bg-transparent text-xs text-[var(--color-text)] outline-none disabled:cursor-not-allowed"
              >
                {COMPOSER_PERMISSION_MODE_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="bg-[var(--color-surface-elevated)] text-[var(--color-text)]"
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex h-8 max-w-44 min-w-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text-muted)]">
              <label htmlFor={modelId} className="sr-only">
                Model
              </label>
              <Brain size={14} aria-hidden="true" />
              <select
                id={modelId}
                aria-label="Model"
                value={model}
                disabled={inputLocked}
                onChange={(event) => setModel(event.target.value as ComposerModel)}
                className="max-w-36 truncate bg-transparent text-xs text-[var(--color-text)] outline-none disabled:cursor-not-allowed"
              >
                {COMPOSER_MODEL_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="bg-[var(--color-surface-elevated)] text-[var(--color-text)]"
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {showStop ? (
              <IconButton
                type="button"
                label="Stop current run"
                variant="primary"
                size="sm"
                onClick={onStop}
                disabled={!canStop}
                className="shrink-0"
              >
                <Square size={13} aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton
                type="submit"
                label="Send message"
                variant="primary"
                size="sm"
                className="shrink-0"
                disabled={!canSend}
              >
                <SendHorizontal size={15} aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
