// Defines the only runtime dependency that app may call.
import type {
  AgentRuntimeCancelRequest,
  AgentRuntimeResumeRequest,
  AgentRuntimeRetryRequest,
  AgentRuntimeStartRequest,
} from './requests';
import type { AppRunControlResponse, AppRunResponse, AppStartRunResponse } from './responses';

export interface AgentRuntimeEvent {
  type: string;
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export interface AgentRuntimePort {
  startRun(request: AgentRuntimeStartRequest): Promise<AppStartRunResponse>;
  resumeRun(request: AgentRuntimeResumeRequest): Promise<AppRunResponse>;
  cancelRun(request: AgentRuntimeCancelRequest): Promise<AppRunControlResponse>;
  retryRun(request: AgentRuntimeRetryRequest): Promise<AppRunControlResponse>;
  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void;
}
