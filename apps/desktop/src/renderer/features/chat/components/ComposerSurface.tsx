import { forwardRef, useRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import {
  Bot,
  Brain,
  Paperclip,
  SendHorizontal,
  Square,
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
  contextUsage?: ChatGetContextUsageUiResult;
  onValueChange: (value: string) => void;
  onCommandSuggestionChoose: (item: CommandSuggestionItem) => void;
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
  contextUsage,
  onValueChange,
  onCommandSuggestionChoose,
  onPermissionModeChange,
  onModelChange,
  onKeyDown,
  onSubmit,
  onStop,
  onAttachFiles,
}, ref) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleAttachFiles() {
    onAttachFiles?.();
    fileInputRef.current?.click();
  }

  return (
    <form
      ref={ref}
      data-testid="composer-surface"
      aria-label="Message composer"
      onSubmit={onSubmit}
      className="pointer-events-auto mx-auto w-full transition-[width,transform,opacity] duration-200 ease-out"
    >
      <CommandSuggestionPanel
        suggestions={commandSuggestions}
        selectedIndex={selectedCommandSuggestionIndex}
        onChoose={onCommandSuggestionChoose}
      />
      <input
        ref={fileInputRef}
        data-testid="composer-file-input"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <div className="overflow-visible rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)] transition-shadow duration-150">
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
            <IconButton label="Attach files" variant="ghost" size="sm" className="shrink-0" onClick={handleAttachFiles}>
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

function ContextUsageIndicator({ contextUsage }: { contextUsage?: ChatGetContextUsageUiResult }) {
  const usage = contextUsage?.status === 'ok' ? contextUsage.usage : null;
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
