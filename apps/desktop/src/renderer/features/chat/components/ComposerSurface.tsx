import { forwardRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import {
  Bot,
  Brain,
  Package,
  Paperclip,
  SendHorizontal,
  Square,
  Terminal,
} from 'lucide-react';
import { IconButton } from '../../../shared/ui';
import type { CommandSuggestionItem, CommandSuggestionResult } from '@megumi/product/host-interface';
import type { ChatGetContextUsageUiResult } from '@megumi/product/host-interface';
import {
  COMPOSER_PERMISSION_MODE_OPTIONS,
  type ComposerModel,
  type ComposerModelOption,
  type ComposerPermissionMode,
} from './composer-options';
import { CommandSuggestionPanel } from './CommandSuggestionPanel';
import type { ComposerDraftImage } from './composer-types';

export interface ComposerSurfaceProps {
  value: string;
  permissionMode: ComposerPermissionMode;
  model: ComposerModel;
  modelOptions: ComposerModelOption[];
  inputLocked: boolean;
  canSend: boolean;
  showStop: boolean;
  canStop: boolean;
  permissionModeId: string;
  modelId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  commandSuggestions: CommandSuggestionResult;
  selectedCommandSuggestionIndex: number;
  selectedCommandCompletion: ComposerCommandCompletionUi | null;
  contextUsage?: ChatGetContextUsageUiResult;
  selectedImages: ComposerDraftImage[];
  canAttachImages: boolean;
  imageInputError?: string;
  onValueChange: (value: string) => void;
  onCommandSuggestionChoose: (item: CommandSuggestionItem) => void;
  onPermissionModeChange: (permissionMode: ComposerPermissionMode) => void;
  onModelChange: (model: ComposerModel) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachFiles?: () => void;
  onRemoveImage: (draftAttachmentId: string) => void;
}

export type ComposerCommandCompletionUi = {
  label: string;
  sourceKind: CommandSuggestionItem['source']['kind'];
};

export const ComposerSurface = forwardRef<HTMLFormElement, ComposerSurfaceProps>(function ComposerSurface({
  value,
  permissionMode,
  model,
  modelOptions,
  inputLocked,
  canSend,
  showStop,
  canStop,
  permissionModeId,
  modelId,
  textareaRef,
  commandSuggestions,
  selectedCommandSuggestionIndex,
  selectedCommandCompletion,
  contextUsage,
  selectedImages,
  canAttachImages,
  imageInputError,
  onValueChange,
  onCommandSuggestionChoose,
  onPermissionModeChange,
  onModelChange,
  onKeyDown,
  onSubmit,
  onStop,
  onAttachFiles,
  onRemoveImage,
}, ref) {
  function handleAttachFiles() {
    onAttachFiles?.();
  }

  return (
    <form
      ref={ref}
      data-testid="composer-surface"
      aria-label="Message composer"
      onSubmit={onSubmit}
      className="pointer-events-auto relative mx-auto w-full transition-[width,transform,opacity] duration-200 ease-out"
    >
      <CommandSuggestionPanel
        suggestions={commandSuggestions}
        selectedIndex={selectedCommandSuggestionIndex}
        onChoose={onCommandSuggestionChoose}
        className="absolute bottom-full left-0 right-0 z-50 max-h-[min(22rem,calc(100vh-12rem))]"
      />
      <div className="overflow-visible rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)] transition-shadow duration-150">
        <div data-testid="composer-input-panel" className="px-4 py-3">
          {selectedImages.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2" aria-label="Selected images">
              {selectedImages.map((image) => (
                <div key={image.draftAttachmentId} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <img src={image.previewDataUrl} alt={image.name} className="h-full w-full object-cover" />
                  <button type="button" aria-label={`Remove ${image.name}`} onClick={() => onRemoveImage(image.draftAttachmentId)} className="absolute right-1 top-1 rounded bg-black/65 px-1 text-xs text-white opacity-0 group-hover:opacity-100">×</button>
                </div>
              ))}
            </div>
          ) : null}
          {imageInputError ? (
            <p role="alert" className="mb-2 text-xs text-[var(--color-danger)]">{imageInputError}</p>
          ) : null}
          <label htmlFor="megumi-composer" className="sr-only">
            Message Megumi
          </label>
          <div className={selectedCommandCompletion ? 'flex items-start gap-2' : ''}>
            {selectedCommandCompletion ? (
              <CommandCompletionChip completion={selectedCommandCompletion} />
            ) : null}
            <textarea
              ref={textareaRef}
              id="megumi-composer"
              value={value}
              disabled={inputLocked}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={selectedCommandCompletion ? 'Add arguments...' : 'Ask Megumi anything...'}
              rows={selectedCommandCompletion ? 1 : 2}
              className={[
                'max-h-40 w-full resize-none border-0 bg-transparent text-sm leading-5 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)] disabled:cursor-not-allowed disabled:opacity-70',
                selectedCommandCompletion ? 'min-h-8 flex-1 py-1' : 'min-h-14',
              ].join(' ')}
            />
          </div>
        </div>

        <div data-testid="composer-toolbar" className="flex min-h-12 flex-nowrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton label="Attach images" variant="ghost" size="sm" className="shrink-0" onClick={handleAttachFiles} disabled={!canAttachImages}>
              <Paperclip size={16} aria-hidden="true" />
            </IconButton>
            <ContextUsageIndicator contextUsage={contextUsage} />
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
                {modelOptions.map((option) => (
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

function CommandCompletionChip({ completion }: { completion: ComposerCommandCompletionUi }) {
  return (
    <span
      data-testid="composer-command-chip"
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-accent-soft)] px-2 text-sm font-medium text-[var(--color-accent)]"
    >
      {completion.sourceKind === 'skill'
        ? <Package size={14} aria-hidden="true" />
        : <Terminal size={14} aria-hidden="true" />}
      <span>{completion.label}</span>
    </span>
  );
}

function ContextUsageIndicator({ contextUsage }: { contextUsage?: ChatGetContextUsageUiResult }) {
  const usage = contextUsage?.status === 'available' ? contextUsage.usage : null;
  const usagePercent = usage?.usedPercent ?? 0;
  const usageProgress = Math.max(0, Math.min(100, usagePercent));

  return (
    <div
      aria-label="Context usage"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={usagePercent}
      className="group relative flex h-8 w-8 shrink-0 items-center justify-center"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4 overflow-visible"
        viewBox="0 0 16 16"
      >
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="color-mix(in srgb, var(--color-text-muted) 46%, transparent)"
          strokeWidth="2.5"
        />
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          pathLength={100}
          stroke="var(--color-accent)"
          strokeLinecap="round"
          strokeWidth="2.5"
          strokeDasharray={`${usageProgress} 100`}
          transform="rotate(-90 8 8)"
        />
      </svg>
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-9 left-1/2 z-20 w-44 -translate-x-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-2 text-center text-xs text-[var(--color-text-muted)] opacity-0 shadow-[var(--shadow-soft)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <div>Context window:</div>
        {usage ? (
          <>
            <div className="mt-1 text-[var(--color-text)]">{usage.usedPercent}% used</div>
            <div className="mt-1">Used {formatTokenCount(usage.usedTokens)} tokens of {formatTokenCount(usage.totalTokens)}</div>
          </>
        ) : (
          <>
            <div className="mt-1 text-[var(--color-text)]">Usage not available</div>
            <div className="mt-1">Open a session or run the agent to calculate usage.</div>
          </>
        )}
      </div>
    </div>
  );
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  return String(tokens);
}
