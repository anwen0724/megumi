// Owns Composer interaction state and builds the host-neutral submit payload.
import { type FormEvent, type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InputSuggestionQueryItem, InputSuggestionQueryResult } from '@megumi/product/host';
import {
  getComposerModelOptionsForProviders,
  modelOptionValue,
  type ComposerModel,
  type ComposerPermissionMode,
} from '../components/composer-options';
import type {
  ComposerDraftAttachment,
  ComposerDraftDocument,
  ComposerDraftImage,
  ComposerProps,
  ComposerSubmitPayload,
} from '../components/composer-types';
import type { ComposerSurfaceProps } from '../components/ComposerSurface';
import { showToast } from '../../../shared/ui';
import { rendererI18n } from '../../../shared/i18n';
import { usePermissionModeStore } from '../../../entities/permission-mode';
import { useModelSelectionStore } from '../../../entities/model-selection';

const COMPOSER_TEXTAREA_COMPACT_HEIGHT = 56;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 160;

type SelectedCommandCompletion = {
  label: string;
  sourceKind: 'command' | 'skill';
  replacementInput: string;
  selection?: { type: 'skill'; name: string; skillPath: string };
};

function createComposerSubmitPayload(input: {
  message: string;
  permissionMode: ComposerPermissionMode;
  providerId: string;
  model: ComposerModel;
  attachments: ComposerDraftAttachment[];
  skillSelection?: SelectedCommandCompletion['selection'];
}): ComposerSubmitPayload {
  return {
    message: input.message,
    permissionMode: input.permissionMode,
    providerId: input.providerId,
    model: input.model,
    ...(input.skillSelection ? { skillSelection: input.skillSelection } : {}),
    ...(input.attachments.length > 0 ? { attachments: input.attachments } : {}),
  };
}

function resolveSubmitMessage(rawValue: string, completion: SelectedCommandCompletion | null): string {
  if (!completion) {
    return rawValue.trim();
  }

  return completion.selection ? rawValue.trim() : `${completion.replacementInput}${rawValue}`.trim();
}

export function useComposerController({
  status = 'idle',
  initialValue = '',
  initialAttachments = [],
  providers,
  contextUsage,
  imageInputCapabilities,
  seedTextKey = null,
  seedText = null,
  onSubmit,
  onStop,
  onChooseContext,
  onSelectImages,
  onSelectDocuments,
  onPasteImage,
  onDraftChange,
  getInputSuggestions,
}: ComposerProps) {
  const permissionModeId = useId();
  const modelId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(initialValue);
  const [selectedCommandCompletion, setSelectedCommandCompletion] = useState<SelectedCommandCompletion | null>(null);
  const [selectedInputSuggestionIndex, setSelectedInputSuggestionIndex] = useState(0);
  const permissionMode = usePermissionModeStore((state) => state.mode);
  const persistPermissionMode = usePermissionModeStore((state) => state.persistMode);
  const modelSelection = useModelSelectionStore((state) => state.selection);
  const persistModelSelection = useModelSelectionStore((state) => state.persistSelection);
  const [selectedAttachments, setSelectedAttachments] = useState<ComposerDraftAttachment[]>(initialAttachments);
  const valueRef = useRef(value);
  const selectedAttachmentsRef = useRef(selectedAttachments);
  const selectedCommandCompletionRef = useRef(selectedCommandCompletion);
  valueRef.current = value;
  selectedAttachmentsRef.current = selectedAttachments;
  selectedCommandCompletionRef.current = selectedCommandCompletion;
  const modelOptions = useMemo(
    () => getComposerModelOptionsForProviders(providers),
    [providers],
  );
  const selectedModelValue = modelSelection
    ? modelOptionValue(modelSelection.providerId, modelSelection.modelId)
    : undefined;
  const selectedModelOption = modelOptions.find((option) => option.value === selectedModelValue)
    ?? modelOptions[0];
  const model = selectedModelOption?.value ?? '';
  const maxImageCount = imageInputCapabilities?.maxImageCount ?? 0;
  const maxDocumentCount = imageInputCapabilities?.maxDocumentCount ?? 0;
  const selectedImages = selectedAttachments.filter(
    (attachment): attachment is ComposerDraftImage => attachment.type === 'image',
  );
  const selectedDocuments = selectedAttachments.filter(
    (attachment): attachment is ComposerDraftDocument => attachment.type === 'file',
  );
  const trimmedValue = value.trim();
  const inputLocked = false;
  const sendLocked = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const imageInputNotice = selectedImages.length > 0 && selectedModelOption?.imageInput === false
    ? 'This model will receive attachment metadata, but not the image content.'
    : undefined;
  const canSend = (
    trimmedValue.length > 0
    || selectedAttachments.length > 0
    || (selectedCommandCompletion !== null && !selectedCommandCompletion.selection)
  )
    && !sendLocked && modelOptions.length > 0;
  const canAttachImages = selectedImages.length < maxImageCount
    && !sendLocked
    && selectedCommandCompletion === null;
  const canAttachDocuments = selectedDocuments.length < maxDocumentCount
    && !sendLocked
    && selectedCommandCompletion === null;
  const showStop = status === 'sending' || status === 'running' || status === 'waiting-approval';
  const canStop = showStop && Boolean(onStop);
  const [inputSuggestions, setInputSuggestions] = useState<InputSuggestionQueryResult>({ type: 'inactive' });
  const activeInputSuggestions = inputSuggestions.type === 'suggestions' && inputSuggestions.draftInput === value
    ? inputSuggestions
    : { type: 'inactive' as const };
  const visibleInputSuggestionItems = activeInputSuggestions.type === 'suggestions'
    ? activeInputSuggestions.groups.flatMap((group) => group.items)
    : [];
  const hasInputSuggestionSelection = visibleInputSuggestionItems.length > 0
    && selectedInputSuggestionIndex >= 0;

  useEffect(() => {
    if (seedTextKey && seedText !== null && seedText !== undefined) {
      setValue(seedText);
      setSelectedCommandCompletion(null);
    }
  }, [seedTextKey, seedText]);

  useEffect(() => {
    onDraftChange?.({ text: value, attachments: selectedAttachments });
  }, [onDraftChange, selectedAttachments, value]);

  useEffect(() => {
    if (modelOptions.length === 0) {
      return;
    }

    const fallback = modelOptions[0];
    if (!selectedModelOption || selectedModelValue !== selectedModelOption.value) {
      void persistModelSelection({ providerId: fallback.providerId, modelId: fallback.modelId });
    }
  }, [modelOptions, persistModelSelection, selectedModelOption, selectedModelValue]);

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
    if (selectedCommandCompletion || !getInputSuggestions || !value.trimStart().startsWith('/')) {
      setInputSuggestions({ type: 'inactive' });
      return undefined;
    }

    let cancelled = false;

    try {
      void Promise.resolve(getInputSuggestions({ draftInput: value }))
        .then((suggestions) => {
          if (!cancelled) {
            setInputSuggestions(suggestions);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setInputSuggestions({ type: 'inactive' });
          }
        });
    } catch {
      setInputSuggestions({ type: 'inactive' });
    }

    return () => {
      cancelled = true;
    };
  }, [getInputSuggestions, selectedCommandCompletion, value]);

  useEffect(() => {
    if (visibleInputSuggestionItems.length === 0) {
      setSelectedInputSuggestionIndex(0);
      return;
    }

    setSelectedInputSuggestionIndex((index) => (
      index >= visibleInputSuggestionItems.length ? 0 : Math.max(0, index)
    ));
  }, [visibleInputSuggestionItems.length]);

  async function submitDraft() {
    if (!canSend) return;
    if (!selectedModelOption) return;

    const submittedDraft = {
      text: value,
      attachments: selectedAttachments,
      commandCompletion: selectedCommandCompletion,
    };
    const payload = createComposerSubmitPayload({
      message: resolveSubmitMessage(value, selectedCommandCompletion),
      permissionMode,
      providerId: selectedModelOption.providerId,
      model: selectedModelOption.modelId,
      attachments: selectedAttachments,
      ...(selectedCommandCompletion?.selection ? { skillSelection: selectedCommandCompletion.selection } : {}),
    });

    // Consume the draft before the asynchronous send can create a Session and
    // replace the welcome Composer with ComposerDock. Otherwise the new
    // Composer instance hydrates from the stale submitted draft.
    valueRef.current = '';
    selectedAttachmentsRef.current = [];
    selectedCommandCompletionRef.current = null;
    onDraftChange?.({ text: '', attachments: [] });
    setValue('');
    setSelectedCommandCompletion(null);
    setSelectedAttachments([]);

    const succeeded = await onSubmit(payload);
    if (succeeded !== false) return;

    // A rejected send restores the consumed draft only when the user has not
    // started composing a replacement while the request was pending.
    if (
      valueRef.current.length === 0 &&
      selectedAttachmentsRef.current.length === 0 &&
      selectedCommandCompletionRef.current === null
    ) {
      valueRef.current = submittedDraft.text;
      selectedAttachmentsRef.current = submittedDraft.attachments;
      selectedCommandCompletionRef.current = submittedDraft.commandCompletion;
      onDraftChange?.({ text: submittedDraft.text, attachments: submittedDraft.attachments });
      setValue(submittedDraft.text);
      setSelectedCommandCompletion(submittedDraft.commandCompletion);
      setSelectedAttachments(submittedDraft.attachments);
    }
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

  async function selectDocuments() {
    if (!canAttachDocuments || !onSelectDocuments) return;
    appendDocuments(await onSelectDocuments());
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
    setSelectedAttachments((current) => [...current, ...images.slice(0, remaining)]);
  }

  function appendDocuments(documents: ComposerDraftDocument[]) {
    const remaining = Math.max(0, maxDocumentCount - selectedDocuments.length);
    if (documents.length > remaining) {
      showToast({
        tone: 'warning',
        title: rendererI18n.t('chat:notifications.documentLimit.title'),
        message: rendererI18n.t('chat:notifications.documentLimit.message', { count: maxDocumentCount }),
      });
    }
    setSelectedAttachments((current) => [...current, ...documents.slice(0, remaining)]);
  }

  function showImageLimitToast() {
    showToast({
      tone: 'warning',
      title: rendererI18n.t('chat:notifications.imageLimit.title'),
      message: rendererI18n.t('chat:notifications.imageLimit.message', { count: maxImageCount }),
    });
  }

  function removeAttachment(draftAttachmentId: string) {
    setSelectedAttachments((current) => current.filter(
      (attachment) => attachment.draftAttachmentId !== draftAttachmentId,
    ));
  }

  function applyInputSuggestion(item: InputSuggestionQueryItem) {
    setValue('');
    setSelectedCommandCompletion({
      replacementInput: item.replacementInput,
      label: getInputSuggestionLabel(item),
      sourceKind: item.kind,
      ...(item.kind === 'skill' ? { selection: item.selection } : {}),
    });
    setSelectedInputSuggestionIndex(0);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isComposing = event.nativeEvent.isComposing || (event as unknown as { isComposing?: boolean }).isComposing;

    if (selectedCommandCompletion && event.key === 'Backspace' && value.length === 0) {
      event.preventDefault();
      setSelectedCommandCompletion(null);
      return;
    }

    if (event.key === 'ArrowDown' && visibleInputSuggestionItems.length > 0) {
      event.preventDefault();
      setSelectedInputSuggestionIndex((index) => (
        index + 1 >= visibleInputSuggestionItems.length ? 0 : index + 1
      ));
      return;
    }

    if (event.key === 'ArrowUp' && visibleInputSuggestionItems.length > 0) {
      event.preventDefault();
      setSelectedInputSuggestionIndex((index) => (
        index <= 0 ? visibleInputSuggestionItems.length - 1 : index - 1
      ));
      return;
    }

    if (!isComposing && (event.key === 'Enter' || event.key === 'Tab') && hasInputSuggestionSelection) {
      event.preventDefault();
      const item = visibleInputSuggestionItems[selectedInputSuggestionIndex];
      if (item) {
        applyInputSuggestion(item);
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

  function chooseInputSuggestion(item: InputSuggestionQueryItem) {
    applyInputSuggestion(item);
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
    inputSuggestions: activeInputSuggestions,
    selectedInputSuggestionIndex,
    onInputSuggestionHover: setSelectedInputSuggestionIndex,
    selectedCommandCompletion,
    contextUsage,
    selectedAttachments,
    canAttachImages,
    canAttachDocuments,
    imageInputNotice,
    onValueChange: handleValueChange,
    onInputSuggestionChoose: chooseInputSuggestion,
    onPermissionModeChange: (mode) => { void persistPermissionMode(mode); },
    onModelChange: (nextModel) => {
      const option = modelOptions.find((candidate) => candidate.value === nextModel);
      if (option) void persistModelSelection({ providerId: option.providerId, modelId: option.modelId });
    },
    onKeyDown: handleComposerKeyDown,
    onSubmit: handleSubmit,
    onStop,
    onChooseContext,
    onAttachImages: () => { void selectImages(); },
    onAttachDocuments: () => { void selectDocuments(); },
    onPasteImage: () => { void pasteImage(); },
    onRemoveAttachment: removeAttachment,
  };

  return {
    composerSurfaceProps,
  };
}

function getInputSuggestionLabel(item: InputSuggestionQueryItem): string {
  return item.name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
