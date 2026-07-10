// Owns Composer interaction state and builds the host-neutral submit payload.
import { type FormEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CommandSuggestionItem, CommandSuggestionResult } from '@megumi/coding-agent/commands';
import {
  DEFAULT_COMPOSER_MODEL,
  DEFAULT_COMPOSER_PERMISSION_MODE,
  getComposerModelOptionsForProviders,
  type ComposerModel,
  type ComposerPermissionMode,
} from '../components/composer-options';
import type { ComposerProps, ComposerSubmitPayload } from '../components/composer-types';
import type { ComposerSurfaceProps } from '../components/ComposerSurface';

const COMPOSER_TEXTAREA_COMPACT_HEIGHT = 56;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 160;

type SelectedCommandCompletion = {
  visiblePrefix: string;
  backendPrefix: string;
};

function createComposerSubmitPayload(input: {
  message: string;
  permissionMode: ComposerPermissionMode;
  providerId: string;
  model: ComposerModel;
}): ComposerSubmitPayload {
  return {
    message: input.message,
    permissionMode: input.permissionMode,
    providerId: input.providerId,
    model: input.model,
  };
}

function createVisibleCommandInput(item: CommandSuggestionItem): string {
  return `/${item.display?.primary ?? item.name} `;
}

function resolveSubmitMessage(rawValue: string, completion: SelectedCommandCompletion | null): string {
  if (!completion || !rawValue.startsWith(completion.visiblePrefix)) {
    return rawValue.trim();
  }

  return `${completion.backendPrefix}${rawValue.slice(completion.visiblePrefix.length)}`.trim();
}

export function useComposerController({
  status = 'idle',
  initialValue = '',
  providers,
  contextUsage,
  seedTextKey = null,
  seedText = null,
  onSubmit,
  onStop,
  onChooseContext,
  onAttachFiles,
  getCommandSuggestions,
}: ComposerProps) {
  const permissionModeId = useId();
  const modelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(initialValue);
  const [selectedCommandCompletion, setSelectedCommandCompletion] = useState<SelectedCommandCompletion | null>(null);
  const [selectedCommandSuggestionIndex, setSelectedCommandSuggestionIndex] = useState(0);
  const [permissionMode, setPermissionMode] = useState<ComposerPermissionMode>(DEFAULT_COMPOSER_PERMISSION_MODE);
  const [model, setModel] = useState<ComposerModel>(DEFAULT_COMPOSER_MODEL);
  const modelOptions = useMemo(
    () => getComposerModelOptionsForProviders(providers),
    [providers],
  );
  const selectedModelOption = modelOptions.find((option) => option.value === model);
  const trimmedValue = value.trim();
  const inputLocked = false;
  const sendLocked = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canSend = trimmedValue.length > 0 && !sendLocked && modelOptions.length > 0;
  const showStop = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canStop = showStop && Boolean(onStop);
  const [commandSuggestions, setCommandSuggestions] = useState<CommandSuggestionResult>({ type: 'inactive' });
  const activeCommandSuggestions = commandSuggestions.type === 'suggestions' && commandSuggestions.draft_input === value
    ? commandSuggestions
    : { type: 'inactive' as const };
  const visibleCommandSuggestionItems = activeCommandSuggestions.type === 'suggestions'
    ? activeCommandSuggestions.groups.flatMap((group) => group.items)
    : [];
  const hasCommandSuggestionSelection = visibleCommandSuggestionItems.length > 0
    && selectedCommandSuggestionIndex >= 0;

  useEffect(() => {
    if (seedTextKey && seedText !== null && seedText !== undefined) {
      setValue(seedText);
      setSelectedCommandCompletion(null);
    }
  }, [seedTextKey, seedText]);

  useEffect(() => {
    if (modelOptions.length === 0) {
      return;
    }

    if (!modelOptions.some((option) => option.value === model)) {
      setModel(modelOptions[0].value);
    }
  }, [model, modelOptions]);

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
    if (!getCommandSuggestions || !value.trimStart().startsWith('/')) {
      setCommandSuggestions({ type: 'inactive' });
      return undefined;
    }

    let cancelled = false;

    try {
      void Promise.resolve(getCommandSuggestions({ draft_input: value }))
        .then((suggestions) => {
          if (!cancelled) {
            setCommandSuggestions(suggestions);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCommandSuggestions({ type: 'inactive' });
          }
        });
    } catch {
      setCommandSuggestions({ type: 'inactive' });
    }

    return () => {
      cancelled = true;
    };
  }, [getCommandSuggestions, value]);

  useEffect(() => {
    if (visibleCommandSuggestionItems.length === 0) {
      setSelectedCommandSuggestionIndex(0);
      return;
    }

    setSelectedCommandSuggestionIndex((index) => (
      index >= visibleCommandSuggestionItems.length ? 0 : Math.max(0, index)
    ));
  }, [visibleCommandSuggestionItems.length]);

  function submitDraft() {
    if (!canSend) return;
    if (!selectedModelOption) return;

    onSubmit(createComposerSubmitPayload({
      message: resolveSubmitMessage(value, selectedCommandCompletion),
      permissionMode,
      providerId: selectedModelOption.providerId,
      model: selectedModelOption.modelId,
    }));
    setValue('');
    setSelectedCommandCompletion(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function insertNewlineAtCursor(textarea: HTMLTextAreaElement) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    setValue(`${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`);
    setSelectedCommandCompletion(null);
  }

  function handleValueChange(nextValue: string) {
    setValue(nextValue);
    setSelectedCommandCompletion((completion) => (
      completion && nextValue.startsWith(completion.visiblePrefix) ? completion : null
    ));
  }

  function applyCommandSuggestion(item: CommandSuggestionItem) {
    const visibleInput = createVisibleCommandInput(item);
    setValue(visibleInput);
    setSelectedCommandCompletion({
      visiblePrefix: visibleInput,
      backendPrefix: item.completion.replacement_input,
    });
    setSelectedCommandSuggestionIndex(0);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isComposing = event.nativeEvent.isComposing || (event as unknown as { isComposing?: boolean }).isComposing;

    if (event.key === 'ArrowDown' && visibleCommandSuggestionItems.length > 0) {
      event.preventDefault();
      setSelectedCommandSuggestionIndex((index) => (
        index + 1 >= visibleCommandSuggestionItems.length ? 0 : index + 1
      ));
      return;
    }

    if (event.key === 'ArrowUp' && visibleCommandSuggestionItems.length > 0) {
      event.preventDefault();
      setSelectedCommandSuggestionIndex((index) => (
        index <= 0 ? visibleCommandSuggestionItems.length - 1 : index - 1
      ));
      return;
    }

    if (!isComposing && (event.key === 'Enter' || event.key === 'Tab') && hasCommandSuggestionSelection) {
      event.preventDefault();
      const item = visibleCommandSuggestionItems[selectedCommandSuggestionIndex];
      if (item) {
        applyCommandSuggestion(item);
      }
      return;
    }

    if (event.key !== 'Enter') {
      return;
    }

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

  function chooseCommandSuggestion(item: CommandSuggestionItem) {
    applyCommandSuggestion(item);
    textareaRef.current?.focus();
  }

  const composerSurfaceProps: ComposerSurfaceProps = {
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
    commandSuggestions: activeCommandSuggestions,
    selectedCommandSuggestionIndex,
    contextUsage,
    onValueChange: handleValueChange,
    onCommandSuggestionChoose: chooseCommandSuggestion,
    onPermissionModeChange: setPermissionMode,
    onModelChange: setModel,
    onKeyDown: handleComposerKeyDown,
    onSubmit: handleSubmit,
    onStop,
    onChooseContext,
    onAttachFiles,
  };

  return {
    composerSurfaceProps,
  };
}
