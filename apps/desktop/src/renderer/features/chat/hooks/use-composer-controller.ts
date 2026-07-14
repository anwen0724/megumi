// Owns Composer interaction state and builds the host-neutral submit payload.
import { type FormEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CommandSuggestionItem, CommandSuggestionResult } from '@megumi/product/host-interface';
import {
  DEFAULT_COMPOSER_MODEL,
  DEFAULT_COMPOSER_PERMISSION_MODE,
  getComposerModelOptionsForProviders,
  type ComposerModel,
  type ComposerPermissionMode,
} from '../components/composer-options';
import type { ComposerDraftImage, ComposerProps, ComposerSubmitPayload } from '../components/composer-types';
import type { ComposerSurfaceProps } from '../components/ComposerSurface';
import { showToast } from '../../../shared/ui';

const COMPOSER_TEXTAREA_COMPACT_HEIGHT = 56;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 160;

type SelectedCommandCompletion = Pick<CommandSuggestionItem, 'displayInput' | 'submitInput'> & {
  label: string;
  sourceKind: CommandSuggestionItem['source']['kind'];
};

function createComposerSubmitPayload(input: {
  message: string;
  permissionMode: ComposerPermissionMode;
  providerId: string;
  model: ComposerModel;
  attachments: ComposerDraftImage[];
}): ComposerSubmitPayload {
  return {
    message: input.message,
    permissionMode: input.permissionMode,
    providerId: input.providerId,
    model: input.model,
    ...(input.attachments.length > 0 ? { attachments: input.attachments } : {}),
  };
}

function resolveSubmitMessage(rawValue: string, completion: SelectedCommandCompletion | null): string {
  if (!completion) {
    return rawValue.trim();
  }

  return `${completion.submitInput}${rawValue}`.trim();
}

export function useComposerController({
  status = 'idle',
  initialValue = '',
  initialImages = [],
  providers,
  contextUsage,
  imageInputCapabilities,
  seedTextKey = null,
  seedText = null,
  onSubmit,
  onStop,
  onChooseContext,
  onSelectImages,
  onPasteImage,
  onDraftChange,
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
  const [selectedImages, setSelectedImages] = useState<ComposerDraftImage[]>(initialImages);
  const modelOptions = useMemo(
    () => getComposerModelOptionsForProviders(providers),
    [providers],
  );
  const selectedModelOption = modelOptions.find((option) => option.value === model);
  const maxImageCount = imageInputCapabilities?.maxImageCount ?? 0;
  const trimmedValue = value.trim();
  const inputLocked = false;
  const sendLocked = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const imageInputNotice = selectedImages.length > 0 && selectedModelOption?.imageInput === false
    ? 'This model will receive attachment metadata, but not the image content.'
    : undefined;
  const canSend = (trimmedValue.length > 0 || selectedImages.length > 0 || selectedCommandCompletion !== null)
    && !sendLocked && modelOptions.length > 0;
  const canAttachImages = selectedImages.length < maxImageCount
    && !sendLocked
    && selectedCommandCompletion === null;
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
    onDraftChange?.({ text: value, images: selectedImages });
  }, [onDraftChange, selectedImages, value]);

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
    const compactHeight = COMPOSER_TEXTAREA_COMPACT_HEIGHT;
    const nextHeight = value
      ? Math.max(compactHeight, Math.min(scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT))
      : compactHeight;

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [selectedCommandCompletion, value]);

  useEffect(() => {
    if (selectedCommandCompletion || !getCommandSuggestions || !value.trimStart().startsWith('/')) {
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
  }, [getCommandSuggestions, selectedCommandCompletion, value]);

  useEffect(() => {
    if (visibleCommandSuggestionItems.length === 0) {
      setSelectedCommandSuggestionIndex(0);
      return;
    }

    setSelectedCommandSuggestionIndex((index) => (
      index >= visibleCommandSuggestionItems.length ? 0 : Math.max(0, index)
    ));
  }, [visibleCommandSuggestionItems.length]);

  async function submitDraft() {
    if (!canSend) return;
    if (!selectedModelOption) return;

    const succeeded = await onSubmit(createComposerSubmitPayload({
      message: resolveSubmitMessage(value, selectedCommandCompletion),
      permissionMode,
      providerId: selectedModelOption.providerId,
      model: selectedModelOption.modelId,
      attachments: selectedImages,
    }));
    if (succeeded === false) return;
    onDraftChange?.({ text: '', images: [] });
    setValue('');
    setSelectedCommandCompletion(null);
    setSelectedImages([]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitDraft();
  }

  function insertNewlineAtCursor(textarea: HTMLTextAreaElement) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    setValue(`${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`);
    setSelectedCommandCompletion(null);
  }

  function handleValueChange(nextValue: string) {
    setValue(nextValue);
  }

  async function selectImages() {
    if (!canAttachImages || !onSelectImages) return;
    const images = await onSelectImages();
    appendImages(images);
  }

  async function pasteImage() {
    if (!onPasteImage || sendLocked || selectedCommandCompletion) return;
    if (selectedImages.length >= maxImageCount) {
      showImageLimitToast();
      return;
    }
    appendImages(await onPasteImage());
  }

  function appendImages(images: ComposerDraftImage[]) {
    const remaining = Math.max(0, maxImageCount - selectedImages.length);
    if (images.length > remaining) {
      showImageLimitToast();
    }
    setSelectedImages((current) => [...current, ...images.slice(0, remaining)]);
  }

  function showImageLimitToast() {
    showToast({
      tone: 'warning',
      title: 'Image limit reached',
      message: `You can attach up to ${maxImageCount} images.`,
    });
  }

  function removeImage(draftAttachmentId: string) {
    setSelectedImages((current) => current.filter((image) => image.draftAttachmentId !== draftAttachmentId));
  }

  function applyCommandSuggestion(item: CommandSuggestionItem) {
    setValue('');
    setSelectedCommandCompletion({
      displayInput: item.displayInput,
      submitInput: item.submitInput,
      label: getCommandChipLabel(item),
      sourceKind: item.source.kind,
    });
    setSelectedCommandSuggestionIndex(0);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isComposing = event.nativeEvent.isComposing || (event as unknown as { isComposing?: boolean }).isComposing;

    if (selectedCommandCompletion && event.key === 'Backspace' && value.length === 0) {
      event.preventDefault();
      setSelectedCommandCompletion(null);
      return;
    }

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
    void submitDraft();
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
    selectedCommandCompletion,
    contextUsage,
    selectedImages,
    canAttachImages,
    imageInputNotice,
    onValueChange: handleValueChange,
    onCommandSuggestionChoose: chooseCommandSuggestion,
    onPermissionModeChange: setPermissionMode,
    onModelChange: setModel,
    onKeyDown: handleComposerKeyDown,
    onSubmit: handleSubmit,
    onStop,
    onChooseContext,
    onAttachFiles: () => { void selectImages(); },
    onPasteImage: () => { void pasteImage(); },
    onRemoveImage: removeImage,
  };

  return {
    composerSurfaceProps,
  };
}

function getCommandChipLabel(item: CommandSuggestionItem): string {
  const rawName = item.display?.primary ?? item.name;
  return rawName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
