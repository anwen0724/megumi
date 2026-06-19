// Defines the renderer-facing window.megumi contract exposed by preload.
import type {
  SessionMessageSendAckDto,
  SessionMessageSendRequestDto,
} from '../../shared/renderer-contracts/session-message';

export interface RendererIpcRequest<TPayload = unknown> {
  operation: string;
  payload?: TPayload;
}

export interface RendererIpcSuccess<TResult = unknown> {
  ok: true;
  data: TResult;
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
type UntypedRendererIpcResult = RendererIpcResult<any>;

export interface MegumiRendererApi {
  windowControls: {
    minimize(): Promise<RendererIpcResult<void>>;
    toggleMaximize(): Promise<RendererIpcResult<void>>;
    close(): Promise<RendererIpcResult<void>>;
  };
  project: {
    list(): Promise<UntypedRendererIpcResult>;
    useExisting(payload: unknown): Promise<UntypedRendererIpcResult>;
    open(payload?: unknown): Promise<UntypedRendererIpcResult>;
    remove(payload: unknown): Promise<UntypedRendererIpcResult>;
  };
  provider: {
    list(): Promise<UntypedRendererIpcResult>;
    update(payload: unknown): Promise<UntypedRendererIpcResult>;
    setApiKey(payload: unknown): Promise<UntypedRendererIpcResult>;
    deleteApiKey(payload: unknown): Promise<UntypedRendererIpcResult>;
  };
  settings: {
    get(payload?: unknown): Promise<UntypedRendererIpcResult>;
    update(payload: unknown): Promise<UntypedRendererIpcResult>;
  };
  session: {
    list(payload?: unknown): Promise<UntypedRendererIpcResult>;
    timeline: { list(payload: unknown): Promise<UntypedRendererIpcResult> };
    message: {
      send(payload: SessionMessageSendRequestDto): Promise<RendererIpcResult<SessionMessageSendAckDto>>;
      cancel(payload: unknown): Promise<UntypedRendererIpcResult>;
    };
    branchDraft: {
      create(payload: unknown): Promise<UntypedRendererIpcResult>;
      cancel(payload: unknown): Promise<UntypedRendererIpcResult>;
    };
  };
  run: {
    listBySession(payload: unknown): Promise<UntypedRendererIpcResult>;
    events: { list(payload: unknown): Promise<UntypedRendererIpcResult> };
  };
  runtime: {
    onEvent(callback: (event: RendererRuntimeEventDto) => void): RendererUnsubscribe;
  };
  chatStream: {
    onEvent(callback: (event: RendererChatStreamEventDto) => void): RendererUnsubscribe;
  };
  approval: {
    resolve(payload: unknown): Promise<UntypedRendererIpcResult>;
  };
  recovery: {
    listRecoverableRuns(payload?: unknown): Promise<UntypedRendererIpcResult>;
    resume(payload: unknown): Promise<UntypedRendererIpcResult>;
    retry(payload: unknown): Promise<UntypedRendererIpcResult>;
    cancel(payload: unknown): Promise<UntypedRendererIpcResult>;
    restoreWorkspaceChangeSet(payload: unknown): Promise<UntypedRendererIpcResult>;
  };
  workspace: {
    files: {
      list(payload: unknown): Promise<UntypedRendererIpcResult>;
      open(payload: unknown): Promise<UntypedRendererIpcResult>;
    };
    changes: {
      list(payload: unknown): Promise<UntypedRendererIpcResult>;
    };
  };
  runContext: {
    get(payload?: unknown): Promise<UntypedRendererIpcResult>;
  };
  plan: {
    list(payload?: unknown): Promise<UntypedRendererIpcResult>;
  };
  tool: {
    list(payload?: unknown): Promise<UntypedRendererIpcResult>;
    execution: { get(payload: unknown): Promise<UntypedRendererIpcResult> };
  };
  artifacts: {
    list(payload?: unknown): Promise<UntypedRendererIpcResult>;
  };
  memory: {
    getSettings(payload?: unknown): Promise<UntypedRendererIpcResult>;
  };
}
