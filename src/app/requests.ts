// Defines entrypoint-neutral requests accepted by the App API adapter.
import type { AppEntryContext } from './entry-context';

export interface AppRawInput {
  id?: string;
  text?: string;
  source?: Record<string, unknown>;
  attachments?: unknown[];
  references?: unknown[];
  selectedRanges?: unknown[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AppStartRunRequest {
  rawInput: AppRawInput;
  sessionId?: string;
  workspaceId?: string;
  modelId?: string;
  providerId?: string;
  permissionMode?: string;
  metadata?: Record<string, unknown>;
}

export interface AppResumeRunRequest {
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  approvalRequestId?: string;
  decision?: 'approve' | 'deny';
  metadata?: Record<string, unknown>;
}

export interface AppCancelRunRequest {
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AppRetryRunRequest {
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeStartRequest extends AppStartRunRequest {
  client: AppEntryContext;
}

export interface AgentRuntimeResumeRequest extends AppResumeRunRequest {
  client: AppEntryContext;
}

export interface AgentRuntimeCancelRequest extends AppCancelRunRequest {
  client: AppEntryContext;
}

export interface AgentRuntimeRetryRequest extends AppRetryRunRequest {
  client: AppEntryContext;
}
