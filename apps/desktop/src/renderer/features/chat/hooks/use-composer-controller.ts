import { type FormEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  type ComposerModel,
  type ComposerPermissionMode,
} from '../components/composer-options';
import type { ComposerProps, ComposerSubmitPayload } from '../components/composer-types';
import type { ComposerSurfaceProps } from '../components/ComposerSurface';
import {
  createInputCommandSubmitPayload,
  listInputCommandSuggestions,
  type CommandDefinition,
} from '../../input-commands';

const COMPOSER_TEXTAREA_COMPACT_HEIGHT = 56;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 160;

function createComposerSubmitPayload(input: {
  message: string;
  permissionMode: ComposerPermissionMode;
  model: ComposerModel;
}): ComposerSubmitPayload {
  const inputCommandPayload = createInputCommandSubmitPayload(input.message);

  if (inputCommandPayload) {
    return {
      ...inputCommandPayload,
      model: input.model,
    };
  }

  return {
    message: input.message,
    permissionMode: input.permissionMode,
    model: input.model,
  };
}

export function useComposerController({
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
  const commandSuggestions = listInputCommandSuggestions(value);
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

  const composerSurfaceProps: ComposerSurfaceProps = {
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
    onValueChange: setValue,
    onPermissionModeChange: setPermissionMode,
    onModelChange: setModel,
    onKeyDown: handleComposerKeyDown,
    onSubmit: handleSubmit,
    onStop,
    onChooseContext,
    onAttachFiles,
  };

  return {
    commandSuggestionPanelProps: showCommandAutocomplete
      ? {
        suggestions: commandSuggestions,
        selectedIndex: commandSelectionIndex,
        onChoose: completeCommand,
      }
      : null,
    composerSurfaceProps,
  };
}
