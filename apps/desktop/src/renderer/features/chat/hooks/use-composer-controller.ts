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

function createComposerSubmitPayload(input: {
  message: string;
  permissionMode: ComposerPermissionMode;
  model: ComposerModel;
}): ComposerSubmitPayload {
  return {
    message: input.message,
    permissionMode: input.permissionMode,
    model: input.model,
  };
}

export function useComposerController({
  status = 'idle',
  initialValue = '',
  enabledProviderIds,
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
  const [selectedCommandSuggestionIndex, setSelectedCommandSuggestionIndex] = useState(0);
  const [permissionMode, setPermissionMode] = useState<ComposerPermissionMode>(DEFAULT_COMPOSER_PERMISSION_MODE);
  const [model, setModel] = useState<ComposerModel>(DEFAULT_COMPOSER_MODEL);
  const modelOptions = useMemo(
    () => getComposerModelOptionsForProviders(enabledProviderIds),
    [enabledProviderIds],
  );
  const trimmedValue = value.trim();
  const inputLocked = false;
  const sendLocked = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canSend = trimmedValue.length > 0 && !sendLocked && modelOptions.length > 0;
  const showStop = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canStop = showStop && Boolean(onStop);
  const commandSuggestions: CommandSuggestionResult = getCommandSuggestions?.({
    draft_input: value,
  }) ?? { type: 'inactive' };
  const visibleCommandSuggestionItems = commandSuggestions.type === 'suggestions'
    ? commandSuggestions.groups.flatMap((group) => group.items)
    : [];
  const hasCommandSuggestionSelection = visibleCommandSuggestionItems.length > 0
    && selectedCommandSuggestionIndex >= 0;

  useEffect(() => {
    if (seedTextKey && seedText !== null && seedText !== undefined) {
      setValue(seedText);
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
        setValue(item.completion.replacement_input);
        setSelectedCommandSuggestionIndex(0);
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
    setValue(item.completion.replacement_input);
    setSelectedCommandSuggestionIndex(0);
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
    commandSuggestions,
    selectedCommandSuggestionIndex,
    onValueChange: setValue,
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
