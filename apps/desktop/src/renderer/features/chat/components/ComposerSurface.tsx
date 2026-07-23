import {
  forwardRef,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Brain,
  FileText,
  ImagePlus,
  Package,
  Paperclip,
  SendHorizontal,
  ShieldAlert,
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
import { ComposerSelect } from './ComposerSelect';
import type { ComposerDraftAttachment } from './composer-types';
import { formatTokenCount } from '../../../shared/i18n';

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
  selectedAttachments: ComposerDraftAttachment[];
  canAttachImages: boolean;
  canAttachDocuments: boolean;
  imageInputNotice?: string;
  onValueChange: (value: string) => void;
  onCommandSuggestionChoose: (item: CommandSuggestionItem) => void;
  onPermissionModeChange: (permissionMode: ComposerPermissionMode) => void;
  onModelChange: (model: ComposerModel) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop?: () => void;
  onChooseContext?: () => void;
  onAttachImages?: () => void;
  onAttachDocuments?: () => void;
  onPasteImage?: () => void;
  onRemoveAttachment: (draftAttachmentId: string) => void;
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
  selectedAttachments,
  canAttachImages,
  canAttachDocuments,
  imageInputNotice,
  onValueChange,
  onCommandSuggestionChoose,
  onPermissionModeChange,
  onModelChange,
  onKeyDown,
  onSubmit,
  onStop,
  onAttachImages,
  onAttachDocuments,
  onPasteImage,
  onRemoveAttachment,
}, ref) {
  const { t } = useTranslation('chat');

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const hasImage = Array.from(event.clipboardData.items).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/'),
    );
    if (hasImage) onPasteImage?.();
  }

  return (
    <form
      ref={ref}
      data-testid="composer-surface"
      aria-label={t('composer.label')}
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
          {selectedAttachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2" aria-label={t('composer.selectedAttachments')}>
              {selectedAttachments.map((attachment) => attachment.type === 'image' ? (
                <div key={attachment.draftAttachmentId} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <img src={attachment.previewDataUrl} alt={attachment.name} className="h-full w-full object-cover" />
                  <button type="button" aria-label={t('composer.removeAttachment', { name: attachment.name })} onClick={() => onRemoveAttachment(attachment.draftAttachmentId)} className="absolute right-1 top-1 rounded bg-black/65 px-1 text-xs text-white opacity-0 group-hover:opacity-100">×</button>
                </div>
              ) : (
                <div key={attachment.draftAttachmentId} className="group relative flex h-16 max-w-64 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 pr-8">
                  <FileText size={20} className="shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                  <span className="truncate text-xs text-[var(--color-text)]">{attachment.name}</span>
                  <button type="button" aria-label={t('composer.removeAttachment', { name: attachment.name })} onClick={() => onRemoveAttachment(attachment.draftAttachmentId)} className="absolute right-2 top-2 rounded px-1 text-xs text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100">×</button>
                </div>
              ))}
            </div>
          ) : null}
          {imageInputNotice ? (
            <p role="status" className="mb-2 text-xs text-[var(--color-warning)]">{imageInputNotice}</p>
          ) : null}
          <label htmlFor="megumi-composer" className="sr-only">
            {t('composer.messageLabel')}
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
              onPaste={handlePaste}
              placeholder={selectedCommandCompletion ? t('composer.argumentsPlaceholder') : t('composer.messagePlaceholder')}
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
            <AttachmentPicker
              canAttachImages={canAttachImages}
              canAttachDocuments={canAttachDocuments}
              onAttachImages={onAttachImages}
              onAttachDocuments={onAttachDocuments}
            />
            <ContextUsageIndicator contextUsage={contextUsage} />
          </div>

          <div data-testid="composer-actions" className="flex min-w-0 shrink-0 items-center justify-end gap-2">
            <div
              title={permissionMode === 'full_access' ? t('composer.fullAccessWarning') : undefined}
              className="min-w-0 max-w-52"
            >
              <ComposerSelect
                id={permissionModeId}
                label={t('composer.permissionMode')}
                value={permissionMode}
                disabled={inputLocked}
                icon={permissionMode === 'full_access' ? <ShieldAlert size={14} /> : <Bot size={14} />}
                warning={permissionMode === 'full_access'}
                menuClassName="min-w-48"
                options={COMPOSER_PERMISSION_MODE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(`composer.permissionModes.${option.value}`),
                }))}
                onChange={onPermissionModeChange}
              />
            </div>

            <div className="min-w-0 max-w-56">
              <ComposerSelect
                id={modelId}
                label={t('composer.model')}
                value={model}
                disabled={inputLocked}
                icon={<Brain size={14} />}
                menuClassName="min-w-52"
                options={modelOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                  meta: option.providerId,
                }))}
                onChange={onModelChange}
              />
            </div>

            {showStop ? (
              <IconButton
                type="button"
                label={t('composer.stop')}
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
                label={t('composer.send')}
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

function AttachmentPicker({
  canAttachImages,
  canAttachDocuments,
  onAttachImages,
  onAttachDocuments,
}: Pick<
  ComposerSurfaceProps,
  'canAttachImages' | 'canAttachDocuments' | 'onAttachImages' | 'onAttachDocuments'
>) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeWhenClickingOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeWhenClickingOutside);
    return () => document.removeEventListener('pointerdown', closeWhenClickingOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <IconButton
        label={t('composer.attachFiles')}
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={() => setOpen((current) => !current)}
        disabled={!canAttachImages && !canAttachDocuments}
      >
        <Paperclip size={16} aria-hidden="true" />
      </IconButton>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 min-w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-1 shadow-[var(--shadow-soft)]"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!canAttachImages}
            onClick={() => {
              setOpen(false);
              onAttachImages?.();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImagePlus size={16} aria-hidden="true" />
            {t('composer.attachImages')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canAttachDocuments}
            onClick={() => {
              setOpen(false);
              onAttachDocuments?.();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText size={16} aria-hidden="true" />
            {t('composer.attachDocuments')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

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
  const { t } = useTranslation('chat');
  const usage = contextUsage?.status === 'available' ? contextUsage.usage : null;
  const usagePercent = usage?.usedPercent ?? 0;
  const usageProgress = Math.max(0, Math.min(100, usagePercent));

  return (
    <div
      aria-label={t('composer.contextUsage')}
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
        <div>{t('composer.contextWindow')}</div>
        {usage ? (
          <>
            <div className="mt-1 text-[var(--color-text)]">{t('composer.usedPercent', { percent: usage.usedPercent })}</div>
            <div className="mt-1">{t('composer.tokenUsage', { used: formatTokenCount(usage.usedTokens), total: formatTokenCount(usage.totalTokens) })}</div>
          </>
        ) : (
          <>
            <div className="mt-1 text-[var(--color-text)]">{t('composer.usageUnavailable')}</div>
            <div className="mt-1">{t('composer.usageHint')}</div>
          </>
        )}
      </div>
    </div>
  );
}
