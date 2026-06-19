// Renderer-facing IPC contracts used by src/ui and src/desktop preload.
import { z } from 'zod';
import type { JsonObject, JsonValue } from '../json';
import type { RuntimeContext } from './runtime';

export const IPC_CHANNELS = {
  runtimeInvoke: 'megumi:invoke',
  runtimeEvent: 'megumi:runtime:event',
  chatStreamEvent: 'megumi:chat-stream:event',
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
  },
  provider: {
    list: 'provider:list',
    update: 'provider:update',
    setApiKey: 'provider:set-api-key',
    deleteApiKey: 'provider:delete-api-key',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
  },
  session: {
    create: 'session:create',
    list: 'session:list',
    message: {
      list: 'session:message:list',
      send: 'session:message:send',
      cancel: 'session:message:cancel',
    },
    branchDraft: {
      create: 'session:branch-draft:create',
      cancel: 'session:branch-draft:cancel',
    },
    timeline: {
      list: 'session:timeline:list',
    },
  },
  run: {
    listBySession: 'run:list-by-session',
    events: {
      list: 'run:events:list',
    },
  },
  runContext: {
    baselineGet: 'run-context:baseline:get',
    sourcesList: 'run-context:sources:list',
  },
  plan: {
    byRunGet: 'plan:by-run:get',
    statusUpdate: 'plan:status:update',
  },
  tool: {
    definitionsList: 'tool:definitions:list',
    executionGet: 'tool:execution:get',
  },
  approval: {
    resolve: 'approval:resolve',
  },
  recovery: {
    recoverableRunsList: 'recovery:recoverable-runs:list',
    resume: 'recovery:resume',
    cancel: 'recovery:cancel',
    retry: 'recovery:retry',
    workspaceRestore: 'recovery:workspace-restore',
  },
  project: {
    list: 'project:list',
    useExisting: 'project:use-existing',
    open: 'project:open',
    remove: 'project:remove',
  },
  artifacts: {
    listByRun: 'artifacts:list-by-run',
    listBySession: 'artifacts:list-by-session',
    get: 'artifacts:get',
    versionGet: 'artifacts:version:get',
    versionCreate: 'artifacts:version:create',
    statusUpdate: 'artifacts:status:update',
    reference: 'artifacts:reference',
  },
  memory: {
    settingsGet: 'memory:settings:get',
    candidateList: 'memory:candidate:list',
    candidateAccept: 'memory:candidate:accept',
    candidateReject: 'memory:candidate:reject',
    candidateArchive: 'memory:candidate:archive',
    candidateEditAndAccept: 'memory:candidate:edit-and-accept',
    memoryList: 'memory:memory:list',
    memoryGet: 'memory:memory:get',
    memoryUpdate: 'memory:memory:update',
    memoryArchive: 'memory:memory:archive',
    memoryDelete: 'memory:memory:delete',
    memoryDisable: 'memory:memory:disable',
    memoryEnable: 'memory:memory:enable',
    sourceRefsList: 'memory:source-refs:list',
    accessLogsList: 'memory:access-logs:list',
    recallPreview: 'memory:recall-preview',
  },
  workspace: {
    files: {
      list: 'workspace:files:list',
      open: 'workspace:files:open',
    },
    changes: {
      list: 'workspace:changes:list',
    },
  },
  chatStream: {
    event: 'chat-stream:event',
  },
  runtime: {
    event: 'runtime:event',
  },
} as const;

type ValueOf<T> = T[keyof T];
type NestedValueOf<T> = T extends string ? T : ValueOf<{ [K in keyof T]: NestedValueOf<T[K]> }>;

export type BusinessIpcChannel = NestedValueOf<typeof IPC_CHANNELS>;

export interface RuntimeIpcRequestMeta<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  channel: TChannel;
  createdAt: string;
  source: 'renderer';
}

export interface RuntimeIpcRequest<
  TPayload = unknown,
  TChannel extends BusinessIpcChannel = BusinessIpcChannel,
> {
  requestId: string;
  payload: TPayload;
  meta: RuntimeIpcRequestMeta<TChannel>;
  context?: RuntimeContext;
}

export interface RuntimeIpcError {
  code: string;
  message: string;
  details?: JsonObject;
}

export interface RuntimeIpcSuccess<
  TResult = unknown,
  TChannel extends BusinessIpcChannel = BusinessIpcChannel,
> {
  ok: true;
  data: TResult;
  meta?: RuntimeIpcResponseMeta<TChannel>;
}

export interface RuntimeIpcFailure<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  ok: false;
  error: RuntimeIpcError;
  meta?: RuntimeIpcResponseMeta<TChannel>;
}

export interface RuntimeIpcResponseMeta<TChannel extends BusinessIpcChannel = BusinessIpcChannel> {
  requestId: string;
  channel: TChannel;
  traceId?: string;
  debugId?: string;
  operationName?: string;
  handledAt: string;
  durationMs?: number;
}

export type RuntimeIpcResult<
  TResult = unknown,
  TChannel extends BusinessIpcChannel = BusinessIpcChannel,
> = RuntimeIpcSuccess<TResult, TChannel> | RuntimeIpcFailure<TChannel>;

export interface ApprovalResolvePayload {
  requestId?: string;
  approvalRequestId: string;
  runId?: string;
  toolCallId?: string;
  decision: 'approved' | 'denied';
  scope: 'once' | 'run' | 'project' | 'local';
  decidedAt: string;
  reason?: string;
  metadata?: JsonObject;
}

export interface WorkspaceRestoreData {
  result: {
    status: 'restored' | 'conflict' | 'failed' | 'partial' | 'noop';
    error?: RuntimeIpcError;
    metadata?: JsonObject;
  };
  fileResults: Array<{
    projectPath: string;
    status: 'restored' | 'conflict' | 'failed' | 'skipped' | 'noop';
    error?: RuntimeIpcError;
    metadata?: JsonObject;
  }>;
}

export interface SessionMessageSendPayload {
  sessionId?: string;
  message: { id: string; text: string; createdAt: string };
  providerId?: string;
  modelId?: string;
  workspace?: { id?: string; label?: string; path?: string };
  sessionTitle?: string;
  permissionMode?: string;
  permissionSource?: string;
  preprocessing?: JsonValue;
  branchDraft?: { branchMarkerId: string; intent: 'branch' | 'rerun' };
  metadata?: JsonObject;
}

export type ProviderListPayload = Record<string, never>;
export interface ProviderListData {
  providers: import('./provider').ProviderPublicStatus[];
}
export interface ProviderUpdatePayload {
  providerId: import('./provider').ProviderId;
  enabled?: boolean;
  displayName?: string;
  baseUrl?: string;
  defaultModelId?: string;
  apiKeyEnv?: string | null;
}
export interface ProviderApiKeyPayload {
  providerId: import('./provider').ProviderId;
  apiKey: string;
}
export interface ProviderDeleteApiKeyPayload {
  providerId: import('./provider').ProviderId;
}

export interface RecoverableRunListData {
  runs: import('./recovery').RecoverableRunSummary[];
}

export interface RunResumePayload {
  runId: string;
  checkpointId?: string;
  requestedBy?: 'user' | 'host' | 'system' | 'approval_flow' | 'retry_flow' | 'crash_recovery';
  reason?: string;
  resumeMode?: string;
  metadata?: JsonObject;
}

export interface RunResumeData {
  runId: string;
  resumed: boolean;
  resumeRequestId?: string;
}

export interface RunCancelPayload {
  runId: string;
  stepId?: string;
  actionId?: string;
  requestedBy: 'user' | 'host' | 'runtime';
  reason: 'user_requested' | 'superseded_by_new_input' | 'permission_changed' | 'host_shutdown' | 'timeout' | 'policy_denied' | 'runtime_error';
  scope: 'run' | 'step' | 'action' | 'background_process';
  metadata?: JsonObject;
}

export interface RunCancelData {
  runId: string;
  cancelled: boolean;
  cancelRequestId?: string;
}

export interface RunRetryPayload {
  runId: string;
  stepId?: string;
  actionId?: string;
  checkpointId?: string;
  requestedBy?: 'user' | 'host' | 'runtime';
  retryKind?: string;
  reason?: string;
  metadata?: JsonObject;
}

export interface RunRetryData {
  runId: string;
  retried: boolean;
  retryRequestId?: string;
}

export const RuntimeIpcRequestSchema = z.object({
  requestId: z.string(),
  payload: z.unknown(),
  meta: z.object({
    channel: z.string(),
    createdAt: z.string(),
    source: z.literal('renderer'),
  }),
  context: z.record(z.unknown()).optional(),
});

export const RuntimeIpcResultSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown(), meta: z.record(z.unknown()).optional() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    }),
    meta: z.record(z.unknown()).optional(),
  }),
]);
