// Builds the renderer DTO for session.message.send without changing chat UI state.
import type { SessionMessageSendRequestDto } from '../../../../shared/renderer-contracts/session-message';
import type { ComposerSubmitPayload } from '../components/Composer';
import { getProviderIdForModel } from '../components/composer-options';
import type { BranchDraftState } from './use-session-timeline';

export interface CreateSessionMessageSendRequestDtoInput {
  payload: ComposerSubmitPayload;
  clientMessageId: string;
  requestId: string;
  traceId: string;
  createdAt: string;
  sessionId?: string;
  workspaceId?: string;
  workspaceLabel?: string;
  workspacePath?: string;
  sessionTitle?: string;
  branchDraft?: BranchDraftState | null;
}

export function createSessionMessageSendRequestDto(
  input: CreateSessionMessageSendRequestDtoInput,
): SessionMessageSendRequestDto {
  const providerId = getProviderIdForModel(input.payload.model);
  const request: SessionMessageSendRequestDto = {
    requestId: input.requestId,
    traceId: input.traceId,
    source: 'renderer',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    providerId,
    modelId: input.payload.model,
    message: {
      id: input.clientMessageId,
      text: input.payload.message,
      createdAt: input.createdAt,
    },
    workspace: {
      ...(input.workspaceId ? { id: input.workspaceId } : {}),
      ...(input.workspaceLabel ? { label: input.workspaceLabel } : {}),
      ...(input.workspacePath ? { path: input.workspacePath } : {}),
    },
    ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
    permissionMode: input.payload.permissionMode,
    ...(input.payload.permissionSource ? { permissionSource: input.payload.permissionSource } : {}),
    ...(input.payload.preprocessing ? { preprocessing: input.payload.preprocessing } : {}),
    ...(input.branchDraft ? {
      branchDraft: {
        branchMarkerId: input.branchDraft.branchMarkerId,
        intent: input.branchDraft.intent,
      },
    } : {}),
    createdAt: input.createdAt,
    metadata: {
      clientMessageId: input.clientMessageId,
    },
  };

  return request;
}
