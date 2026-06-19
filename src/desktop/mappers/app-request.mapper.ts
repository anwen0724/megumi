// Converts renderer payloads into App API requests without parsing Agent input.
import type {
  AppCancelRunRequest,
  AppClientContext,
  AppResumeRunRequest,
  AppRetryRunRequest,
  AppStartRunRequest,
} from '../../app';

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined;
}

export function createDesktopClientContext(): AppClientContext {
  return {
    clientKind: 'desktop',
    requestId: `request-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    capabilities: { streaming: true, approval: true, filePicker: true, workspacePanel: true },
  };
}

export function mapRendererMessageSendToAppStartRun(payload: unknown): AppStartRunRequest {
  const record = getRecord(payload);
  return {
    rawInput: {
      text: getString(record, 'text') ?? getString(record, 'message') ?? '',
      source: { kind: 'composer' },
      createdAt: new Date().toISOString(),
      metadata: record,
    },
    sessionId: getString(record, 'sessionId'),
    workspaceId: getString(record, 'workspaceId'),
    modelId: getString(record, 'modelId'),
    providerId: getString(record, 'providerId'),
    metadata: record,
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
    runId: getString(record, 'runId') ?? '',
    sessionId: getString(record, 'sessionId'),
    workspaceId: getString(record, 'workspaceId'),
    reason: getString(record, 'reason'),
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
