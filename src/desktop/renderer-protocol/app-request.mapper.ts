// Converts renderer DTOs into App API requests without parsing Agent input.
import type {
  AppCancelRunRequest,
  AppClientContext,
  AppResumeRunRequest,
  AppRetryRunRequest,
  AppStartRunRequest,
} from '../../app';
import {
  isSessionMessageSendRequestDto,
  type SessionMessageSendRequestDto,
} from '../../shared/renderer-contracts/session-message';

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function assertSessionMessageSendRequestDto(value: unknown): SessionMessageSendRequestDto {
  if (!isSessionMessageSendRequestDto(value)) {
    throw new Error('session.message.send expects SessionMessageSendRequestDto');
  }
  return value;
}

export function createDesktopClientContext(payload?: unknown): AppClientContext {
  if (isSessionMessageSendRequestDto(payload)) {
    return {
      clientKind: 'desktop',
      requestId: payload.requestId,
      createdAt: payload.createdAt,
      capabilities: { streaming: true, approval: true, filePicker: true, workspacePanel: true },
      workspaceHint: payload.workspace?.path,
      metadata: {
        traceId: payload.traceId,
        source: payload.source,
      },
    };
  }

  return {
    clientKind: 'desktop',
    requestId: `request-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    capabilities: { streaming: true, approval: true, filePicker: true, workspacePanel: true },
  };
}

export function mapRendererMessageSendToAppStartRun(payload: unknown): AppStartRunRequest {
  const request = assertSessionMessageSendRequestDto(payload);
  return {
    rawInput: {
      id: request.message.id,
      text: request.message.text,
      source: {
        kind: 'composer',
        requestId: request.requestId,
        traceId: request.traceId,
      },
      attachments: [],
      references: [],
      selectedRanges: [],
      createdAt: request.message.createdAt,
      metadata: {
        clientMessageId: request.metadata?.clientMessageId ?? request.message.id,
        ...(request.workspace?.label ? { workspaceLabel: request.workspace.label } : {}),
        ...(request.workspace?.path ? { workspacePath: request.workspace.path } : {}),
        ...(request.sessionTitle ? { sessionTitle: request.sessionTitle } : {}),
        ...(request.preprocessing !== undefined ? { preprocessing: request.preprocessing } : {}),
        ...(request.branchDraft ? { branchDraft: request.branchDraft } : {}),
      },
    },
    sessionId: request.sessionId,
    workspaceId: request.workspace?.id,
    modelId: request.modelId,
    providerId: request.providerId,
    permissionMode: request.permissionMode,
    metadata: {
      requestId: request.requestId,
      traceId: request.traceId,
      source: request.source,
      ...(request.permissionSource ? { permissionSource: request.permissionSource } : {}),
      ...(request.workspace?.label ? { workspaceLabel: request.workspace.label } : {}),
      ...(request.workspace?.path ? { workspacePath: request.workspace.path } : {}),
      ...(request.sessionTitle ? { sessionTitle: request.sessionTitle } : {}),
      ...(request.branchDraft ? { branchDraft: request.branchDraft } : {}),
    },
  };
}

export function mapRendererApprovalToAppResume(payload: unknown): AppResumeRunRequest {
  const record = getRecord(payload);
  return {
    runId: getString(record, 'runId') ?? '',
    sessionId: getString(record, 'sessionId'),
    workspaceId: getString(record, 'workspaceId'),
    approvalRequestId: getString(record, 'approvalRequestId'),
    decision: record.decision === 'deny' ? 'deny' : 'approve',
    metadata: record,
  };
}

export function mapRendererCancelToAppCancel(payload: unknown): AppCancelRunRequest {
  const record = getRecord(payload);
  return {
    runId: getString(record, 'runId') ?? getString(record, 'targetRunId') ?? '',
    sessionId: getString(record, 'sessionId'),
    workspaceId: getString(record, 'workspaceId'),
    reason: getString(record, 'reason') ?? getString(record, 'targetRequestId'),
    metadata: record,
  };
}

export function mapRendererRetryToAppRetry(payload: unknown): AppRetryRunRequest {
  const record = getRecord(payload);
  return {
    runId: getString(record, 'runId') ?? '',
    sessionId: getString(record, 'sessionId'),
    workspaceId: getString(record, 'workspaceId'),
    reason: getString(record, 'reason'),
    metadata: record,
  };
}
