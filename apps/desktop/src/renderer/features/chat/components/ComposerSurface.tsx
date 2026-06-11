import { forwardRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import {
  AtSign,
  Bot,
  Brain,
  Paperclip,
  SendHorizontal,
  Square,
} from 'lucide-react';
import { Button, IconButton } from '../../../shared/ui';
import {
  COMPOSER_MODEL_OPTIONS,
  COMPOSER_PERMISSION_MODE_OPTIONS,
  type ComposerModel,
  type ComposerPermissionMode,
} from './composer-options';

export interface ComposerSurfaceProps {
  value: string;
  permissionMode: ComposerPermissionMode;
  model: ComposerModel;
  inputLocked: boolean;
  canSend: boolean;
  showStop: boolean;
  canStop: boolean;
  permissionModeId: string;
  modelId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onValueChange: (value: string) => void;
  onPermissionModeChange: (permissionMode: ComposerPermissionMode) => void;
  onModelChange: (model: ComposerModel) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
}

export const ComposerSurface = forwardRef<HTMLFormElement, ComposerSurfaceProps>(function ComposerSurface({
  value,
  permissionMode,
  model,
  inputLocked,
  canSend,
  showStop,
  canStop,
  permissionModeId,
  modelId,
  textareaRef,
  onValueChange,
  onPermissionModeChange,
  onModelChange,
  onKeyDown,
  onSubmit,
  onStop,
  onChooseContext,
  onAttachFiles,
}, ref) {
  return (
    <form
      ref={ref}
      data-testid="composer-surface"
      aria-label="Message composer"
      onSubmit={onSubmit}
      className="pointer-events-auto mx-auto w-full transition-[width,transform,opacity] duration-200 ease-out"
    >
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)] transition-shadow duration-150">
        <div data-testid="composer-input-panel" className="px-4 py-3">
          <label htmlFor="megumi-composer" className="sr-only">
            Message Megumi
          </label>
          <textarea
            ref={textareaRef}
            id="megumi-composer"
            value={value}
            disabled={inputLocked}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Megumi anything..."
            rows={2}
            className="max-h-40 min-h-14 w-full resize-none border-0 bg-transparent text-sm leading-5 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)] disabled:cursor-not-allowed disabled:opacity-70"
          />
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
                onChange={(event) => onPermissionModeChange(event.target.value as ComposerPermissionMode)}
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
                onChange={(event) => onModelChange(event.target.value as ComposerModel)}
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
});
