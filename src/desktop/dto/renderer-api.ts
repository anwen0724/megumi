// Defines the renderer-facing window.megumi contract exposed by preload.
export interface RendererIpcRequest<TPayload = unknown> {
  operation: string;
  payload?: TPayload;
}

export interface RendererIpcSuccess<TResult = unknown> {
  ok: true;
  value: TResult;
}

export interface RendererIpcFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type RendererIpcResult<TResult = unknown> = RendererIpcSuccess<TResult> | RendererIpcFailure;

export interface RendererRuntimeEventDto {
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface RendererChatStreamEventDto {
  type: string;
  occurredAt: string;
  sessionId?: string;
  runId?: string;
  payload: Record<string, unknown>;
}

export type RendererUnsubscribe = () => void;

export interface MegumiRendererApi {
  windowControls: {
    minimize(): Promise<RendererIpcResult<void>>;
    toggleMaximize(): Promise<RendererIpcResult<void>>;
    close(): Promise<RendererIpcResult<void>>;
  };
  project: {
    list(): Promise<RendererIpcResult<unknown>>;
    useExisting(payload: unknown): Promise<RendererIpcResult<unknown>>;
    open(payload?: unknown): Promise<RendererIpcResult<unknown>>;
    remove(payload: unknown): Promise<RendererIpcResult<unknown>>;
  };
  provider: {
    list(): Promise<RendererIpcResult<unknown>>;
    update(payload: unknown): Promise<RendererIpcResult<unknown>>;
    setApiKey(payload: unknown): Promise<RendererIpcResult<unknown>>;
    deleteApiKey(payload: unknown): Promise<RendererIpcResult<unknown>>;
  };
  settings: {
    get(): Promise<RendererIpcResult<unknown>>;
    update(payload: unknown): Promise<RendererIpcResult<unknown>>;
  };
  session: {
    list(payload?: unknown): Promise<RendererIpcResult<unknown>>;
    timeline: { list(payload: unknown): Promise<RendererIpcResult<unknown>> };
    message: {
      send(payload: unknown): Promise<RendererIpcResult<unknown>>;
      cancel(payload: unknown): Promise<RendererIpcResult<unknown>>;
    };
    branchDraft: {
      create(payload: unknown): Promise<RendererIpcResult<unknown>>;
      cancel(payload: unknown): Promise<RendererIpcResult<unknown>>;
    };
  };
  run: {
    listBySession(payload: unknown): Promise<RendererIpcResult<unknown>>;
    events: { list(payload: unknown): Promise<RendererIpcResult<unknown>> };
  };
  runtime: {
    onEvent(callback: (event: RendererRuntimeEventDto) => void): RendererUnsubscribe;
  };
  chatStream: {
    onEvent(callback: (event: RendererChatStreamEventDto) => void): RendererUnsubscribe;
  };
  approval: {
    resolve(payload: unknown): Promise<RendererIpcResult<unknown>>;
  };
  recovery: {
    listRecoverableRuns(payload?: unknown): Promise<RendererIpcResult<unknown>>;
    resume(payload: unknown): Promise<RendererIpcResult<unknown>>;
    retry(payload: unknown): Promise<RendererIpcResult<unknown>>;
    cancel(payload: unknown): Promise<RendererIpcResult<unknown>>;
    restoreWorkspaceChangeSet(payload: unknown): Promise<RendererIpcResult<unknown>>;
  };
  workspace: {
    files: {
      list(payload: unknown): Promise<RendererIpcResult<unknown>>;
      open(payload: unknown): Promise<RendererIpcResult<unknown>>;
    };
  };
  runContext: {
    get(payload?: unknown): Promise<RendererIpcResult<unknown>>;
  };
  plan: {
    list(payload?: unknown): Promise<RendererIpcResult<unknown>>;
  };
  tool: {
    list(payload?: unknown): Promise<RendererIpcResult<unknown>>;
  };
  artifacts: {
    list(payload?: unknown): Promise<RendererIpcResult<unknown>>;
  };
  memory: {
    getSettings(payload?: unknown): Promise<RendererIpcResult<unknown>>;
  };
}
