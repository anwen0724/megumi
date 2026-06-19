// Defines entrypoint-neutral responses returned by the App API adapter.
export type AppRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AppErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AppRunResponse {
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  status: AppRunStatus;
  waiting?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: AppErrorResponse;
  metadata?: Record<string, unknown>;
}

export type AppStartRunResponse = AppRunResponse;
export type AppRunControlResponse = AppRunResponse;
