// Builds current-turn and reused session-derived model context parts.
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model';
import type { SessionMessage } from '@megumi/shared/session';

import type { ModelInputContextPartDraft } from '../context-budget';

export function draftFromFinalPart(part: ModelInputContextPart): ModelInputContextPartDraft {
  const {
    tokenEstimate: _tokenEstimate,
    truncation,
    ...draftWithBudgetStatus
  } = part;
  const draft = { ...draftWithBudgetStatus } as Record<string, unknown>;
  delete draft.budgetStatus;

  return {
    ...draft,
    ...(truncation ? { truncationHint: truncation } : {}),
  } as ModelInputContextPartDraft;
}

export function currentTurnPart(
  message: SessionMessage,
  builtAt: string,
  inputPreprocessing?: InputPreprocessingResult,
): ModelInputContextPartDraft {
  return {
    partId: `part:current-turn:${message.messageId}`,
    kind: 'current_turn',
    role: message.role === 'user' ? 'user' : 'host',
    text: inputPreprocessing?.effectiveUserText ?? message.content,
    sourceRefs: [sessionMessageSourceRef(message, builtAt, 'current_user_message', inputPreprocessing)],
    priority: 95,
    budgetClass: 'required',
    required: true,
    metadata: {
      role: message.role,
      status: message.status,
    },
  };
}

function sessionMessageSourceRef(
  message: SessionMessage,
  builtAt: string,
  sourceKind: ModelInputContextSourceRef['sourceKind'] = 'session_message',
  inputPreprocessing?: InputPreprocessingResult,
): ModelInputContextSourceRef {
  return {
    sourceId: `session-message:${message.messageId}`,
    sourceKind,
    sourceUri: `session-message://${message.messageId}`,
    loadedAt: message.completedAt ?? message.createdAt ?? builtAt,
    metadata: {
      role: message.role,
      status: message.status,
      ...(inputPreprocessing ? {
        originalText: inputPreprocessing.originalText,
        inputPreprocessingEntryKinds: inputPreprocessing.entries.map((entry) => entry.kind).join(','),
      } : {}),
    },
  };
}
