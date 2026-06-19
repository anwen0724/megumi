// Defines the renderer-facing session.message.send DTO shared by src/ui and src/desktop.
export interface SessionMessageSendRequestMessageDto {
  id: string;
  text: string;
  createdAt: string;
}

export interface SessionMessageSendWorkspaceDto {
  id?: string;
  label?: string;
  path?: string;
}

export interface SessionMessageSendBranchDraftDto {
  branchMarkerId: string;
  intent: 'branch' | 'rerun';
}

export interface SessionMessageSendRequestDto {
  requestId: string;
  traceId: string;
  source: 'renderer';
  sessionId?: string;
  providerId: string;
  modelId: string;
  message: SessionMessageSendRequestMessageDto;
  workspace?: SessionMessageSendWorkspaceDto;
  sessionTitle?: string;
  permissionMode?: string;
  permissionSource?: string;
  preprocessing?: unknown;
  branchDraft?: SessionMessageSendBranchDraftDto;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface SessionMessageSendAckDto {
  requestId: string;
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  status: string;
  accepted: boolean;
  waiting?: Record<string, unknown>;
  error?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isMessage(value: unknown): value is SessionMessageSendRequestMessageDto {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'string';
}

function isWorkspace(value: unknown): value is SessionMessageSendWorkspaceDto {
  return value === undefined || (
    isRecord(value) &&
    isOptionalString(value.id) &&
    isOptionalString(value.label) &&
    isOptionalString(value.path)
  );
}

function isBranchDraft(value: unknown): value is SessionMessageSendBranchDraftDto {
  return value === undefined || (
    isRecord(value) &&
    typeof value.branchMarkerId === 'string' &&
    (value.intent === 'branch' || value.intent === 'rerun')
  );
}

export function isSessionMessageSendRequestDto(value: unknown): value is SessionMessageSendRequestDto {
  return isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.traceId === 'string' &&
    value.source === 'renderer' &&
    isOptionalString(value.sessionId) &&
    typeof value.providerId === 'string' &&
    typeof value.modelId === 'string' &&
    isMessage(value.message) &&
    isWorkspace(value.workspace) &&
    isOptionalString(value.sessionTitle) &&
    isOptionalString(value.permissionMode) &&
    isOptionalString(value.permissionSource) &&
    isBranchDraft(value.branchDraft) &&
    typeof value.createdAt === 'string' &&
    (value.metadata === undefined || isRecord(value.metadata));
}
