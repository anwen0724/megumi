// Converts App responses into renderer result payloads.
import type { AppRunResponse } from '../../app';
import {
  isSessionMessageSendRequestDto,
  type SessionMessageSendAckDto,
} from '../../shared/renderer-contracts/session-message';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAppRunResponse(value: unknown): value is AppRunResponse {
  return isRecord(value) &&
    typeof value.runId === 'string' &&
    typeof value.status === 'string';
}

export function mapAppResponseToRenderer(value: unknown, rendererRequest?: unknown): unknown {
  if (!isAppRunResponse(value)) {
    return value;
  }

  const requestId = isSessionMessageSendRequestDto(rendererRequest)
    ? rendererRequest.requestId
    : `renderer-ack-${value.runId}`;

  const ack: SessionMessageSendAckDto = {
    requestId,
    runId: value.runId,
    ...(value.sessionId ? { sessionId: value.sessionId } : {}),
    ...(value.workspaceId ? { workspaceId: value.workspaceId } : {}),
    status: value.status,
    accepted: !value.error && value.status !== 'failed' && value.status !== 'cancelled',
    ...(value.waiting ? { waiting: value.waiting } : {}),
    ...(value.error ? { error: value.error as unknown as Record<string, unknown> } : {}),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };

  return ack;
}
