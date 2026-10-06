/*
 * Binds AI once and owns the state, cancellation and final result of each independent run.
 */
import type { Api, AssistantMessage, Message, Model, Models, ThinkingLevel } from '@megumi/ai';
import { randomUUID } from 'node:crypto';
import type { AgentContext, ExecutionEnvironment } from '../context/context-contracts';
import { observeOperation, reportDiagnostic, type AgentDiagnostics } from '../diagnostics';
import type { AgentPermissionRules } from '../permissions/authorize-tool';
import { createSandbox, type Sandbox } from '../sandbox/sandbox-scope';
import type {
  AgentTool,
  ApprovalDecision,
  ApprovalRequest,
  PermissionMode,
  ToolExecutionNotification,
  ToolExecutionResult,
} from '../tools/tool-contracts';
import { runAgentLoop } from './agent-loop';

export interface AgentExecutionPolicy {
  readonly maxModelCallsPerExecution: number;
  readonly maxToolRoundsPerExecution: number;
  readonly maxToolCallsPerModelCall: number;
  readonly maxToolCallsPerExecution: number;
  readonly maxConcurrentToolExecutions: number;
  readonly modelCallTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;
  readonly maxModelCallAttempts: number;
  readonly modelRetryDelayMs: number;
  readonly maxContextOverflowRecoveries: number;
  readonly providerRequestMaxRetries: number;
  readonly providerRequestMaxRetryDelayMs: number;
}

export interface AgentConfig {
  readonly model: Model<Api>;
  /** Product-selected thinking effort, passed unchanged to the AI adapter. */
  readonly reasoning?: ThinkingLevel;
  readonly tools: readonly AgentTool[];
  readonly permissionMode: PermissionMode;
  readonly environment?: ExecutionEnvironment;
  readonly policy: AgentExecutionPolicy;
  readonly completeAfterTool?: string;
}

export interface SaveMessageRequest {
  readonly runId: string;
  readonly messageId: string;
  readonly message: Message;
}

export type AgentPhase =
  | 'saving_message'
  | 'preparing_context'
  | 'compacting_context'
  | 'calling_model'
  | 'executing_tools'
  | 'cleanup';

export interface AgentError {
  readonly code:
    | 'MESSAGE_SAVE_FAILED'
    | 'CONTEXT_FAILED'
    | 'CONTEXT_OVERFLOW'
    | 'MODEL_CALL_FAILED'
    | 'MODEL_TIMEOUT'
    | 'MODEL_PROTOCOL_ERROR'
    | 'TOOL_SYSTEM_FAILED'
    | 'EXECUTION_LIMIT_REACHED'
    | 'CLEANUP_FAILED';
  readonly message: string;
  readonly retryable: boolean;
}

export type AgentResult = {
  readonly runId: string;
  readonly runMessages: readonly Message[];
} & (
  | { readonly status: 'completed'; readonly reason: 'model_response' | 'tool_completed' }
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'failed';
      readonly phase: AgentPhase;
      readonly error: AgentError;
      readonly cancellationRequested: boolean;
    }
);

export interface AgentSnapshot {
  readonly runId: string;
  readonly status: 'running' | 'waiting' | 'cancelling' | AgentResult['status'];
  readonly phase: AgentPhase;
  readonly turn: number;
  readonly attempt: number;
  readonly runMessages: readonly Message[];
  readonly pendingToolCallIds: readonly string[];
  readonly streamingMessage?: AssistantMessage;
}

export type AgentEvent = { readonly runId: string } & (
  | { readonly type: 'state_changed'; readonly snapshot: AgentSnapshot }
  | { readonly type: 'message'; readonly messageId: string; readonly message: Message }
  | { readonly type: 'message_saved'; readonly messageId: string }
  | {
      readonly type: 'model_update';
      readonly messageId: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: 'model_attempt';
      readonly turn: number;
      readonly attempt: number;
      readonly outcome: 'started' | 'retrying' | 'completed' | 'failed';
    }
  | {
      readonly type: 'tool_started';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly arguments: unknown;
    }
  | {
      readonly type: 'tool_output';
      readonly toolCallId: string;
      readonly output: {
        readonly stream: 'stdout' | 'stderr';
        readonly chunk: string;
        readonly truncated: boolean;
      };
    }
  | {
      readonly type: 'tool_finished';
      readonly toolCallId: string;
      readonly result: ToolExecutionResult;
    }
  | {
      readonly type: 'tool_notification';
      readonly toolCallId: string;
      readonly notification: ToolExecutionNotification;
    }
  | { readonly type: 'ended'; readonly result: AgentResult }
);

export interface StartAgentRequest {
  readonly config: AgentConfig;
  readonly input: Extract<Message, { role: 'user' }>;
  readonly context: AgentContext;
  readonly saveMessage?: (request: SaveMessageRequest) => Promise<void>;
  readonly awaitApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly signal?: AbortSignal;
}

export interface AgentRun {
  readonly runId: string;
  snapshot(): AgentSnapshot;
  readonly completion: Promise<AgentResult>;
  /** Requests cancellation; completion waits for saving and cleanup. */
  cancel(): void;
}

export interface Agent {
  /** Creates an independent run; business admission belongs to the product. */
  startAgent(request: StartAgentRequest): AgentRun;
}

export interface CreateAgentRequest {
  readonly ai: Pick<Models, 'streamSimple' | 'completeSimple'>;
  readonly diagnostics?: AgentDiagnostics;
  readonly permissionRules?: AgentPermissionRules;
  readonly sandbox?: Sandbox;
}

/** Binds the configured AI service without making a model request. */
export function createAgent(options: CreateAgentRequest): Agent {
  const capabilities = { ...options, sandbox: options.sandbox ?? createSandbox() };
  return { startAgent: (request) => startRun(capabilities, request) };
}

/** Execution failures carry a stable public code and retain their original diagnostic cause. */
export class AgentFailure extends Error {
  constructor(
    readonly phase: AgentPhase,
    readonly detail: AgentError,
    options?: ErrorOptions,
  ) {
    super(detail.message, options);
  }
}

export interface RunExecution {
  readonly runId: string;
  readonly request: StartAgentRequest;
  readonly ai: CreateAgentRequest['ai'];
  readonly diagnostics?: AgentDiagnostics;
  readonly signal: AbortSignal;
  readonly messages: Message[];
  readonly sandbox: Sandbox;
  readonly permissionRules?: AgentPermissionRules;
  approvalWaiting(approvalId: string, waiting: boolean): void;
  emit(event: AgentEvent): void;
  progress(
    update: Partial<
      Pick<AgentSnapshot, 'phase' | 'turn' | 'attempt' | 'pendingToolCallIds' | 'streamingMessage'>
    >,
  ): void;
  record(message: Message, messageId?: string): Promise<void>;
}

/** Creates isolated run data before asynchronously advancing the execution. */
function startRun(
  options: CreateAgentRequest & { readonly sandbox: Sandbox },
  source: StartAgentRequest,
): AgentRun {
  const runId = randomUUID();
  const controller = new AbortController();
  const signal = source.signal
    ? AbortSignal.any([source.signal, controller.signal])
    : controller.signal;
  const request: StartAgentRequest = {
    ...source,
    input: structuredClone(source.input),
    config: {
      ...source.config,
      model: structuredClone(source.config.model),
      policy: { ...source.config.policy },
      environment: source.config.environment && { ...source.config.environment },
      tools: source.config.tools.map(({ operations, execute, ...definition }) => ({
        ...structuredClone(definition),
        operations,
        execute,
      })),
    },
  };
  const messages: Message[] = [];
  const approvals = new Set<string>();
  let state: AgentSnapshot = {
    runId,
    status: signal.aborted ? 'cancelling' : 'running',
    phase: 'saving_message',
    turn: 0,
    attempt: 0,
    runMessages: messages,
    pendingToolCallIds: [],
  };
  let settled = false;
  const snapshot = () => structuredClone(state);
  const emit = (event: AgentEvent) => {
    try {
      // An async observer is still observational: observe rejection without blocking execution.
      const observed = request.onEvent?.(structuredClone(event));
      Promise.resolve(observed).catch((error) =>
        reportDiagnostic(options.diagnostics, runId, error),
      );
    } catch (error) {
      reportDiagnostic(options.diagnostics, runId, error);
    }
  };
  const progress: RunExecution['progress'] = (update) => {
    state = { ...state, ...update };
    emit({ type: 'state_changed', runId, snapshot: snapshot() });
  };
  const onAbort = () => {
    state = { ...state, status: 'cancelling' };
    emit({ type: 'state_changed', runId, snapshot: snapshot() });
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const execution: RunExecution = {
    runId,
    request,
    ai: options.ai,
    diagnostics: options.diagnostics,
    signal,
    messages,
    progress,
    emit,
    sandbox: options.sandbox,
    permissionRules: options.permissionRules,
    approvalWaiting(approvalId, waiting) {
      if (waiting) approvals.add(approvalId);
      else approvals.delete(approvalId);
      state = {
        ...state,
        status: signal.aborted ? 'cancelling' : approvals.size ? 'waiting' : 'running',
      };
      emit({ type: 'state_changed', runId, snapshot: snapshot() });
    },
    async record(message, messageId = randomUUID()) {
      const owned = structuredClone(message);
      messages.push(owned);
      emit({ type: 'message', runId, messageId, message: owned });
      if (!request.saveMessage) return;
      progress({ phase: 'saving_message' });
      try {
        await request.saveMessage({ runId, messageId, message: structuredClone(owned) });
      } catch (cause) {
        throw new AgentFailure(
          'saving_message',
          {
            code: 'MESSAGE_SAVE_FAILED',
            message: 'Could not save an execution message.',
            retryable: false,
          },
          { cause },
        );
      }
      emit({ type: 'message_saved', runId, messageId });
    },
  };
  const completion = Promise.resolve().then(() =>
    observeOperation(
      options.diagnostics,
      { runId, name: 'agent.execution' },
      async (): Promise<AgentResult> => {
        let result: AgentResult;
        try {
          const reason = await runAgentLoop(execution);
          result = signal.aborted
            ? { runId, status: 'cancelled', runMessages: messages }
            : { runId, status: 'completed', reason, runMessages: messages };
        } catch (cause) {
          if (signal.aborted && !(cause instanceof AgentFailure)) {
            result = { runId, status: 'cancelled', runMessages: messages };
          } else {
            reportDiagnostic(options.diagnostics, runId, cause);
            result = {
              runId,
              status: 'failed',
              runMessages: messages,
              cancellationRequested: signal.aborted,
              phase: cause instanceof AgentFailure ? cause.phase : state.phase,
              error:
                cause instanceof AgentFailure
                  ? cause.detail
                  : {
                      code:
                        state.phase === 'preparing_context' || state.phase === 'compacting_context'
                          ? 'CONTEXT_FAILED'
                          : 'TOOL_SYSTEM_FAILED',
                      message: 'Agent execution failed.',
                      retryable: false,
                    },
            };
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
        settled = true;
        state = {
          ...state,
          status: result.status,
          phase: 'cleanup',
          pendingToolCallIds: [],
          streamingMessage: undefined,
        };
        const final = freezeResult(structuredClone(result));
        emit({ type: 'ended', runId, result: final });
        return final;
      },
      (result) =>
        result.status === 'failed'
          ? { status: 'error', ...result.error }
          : { status: result.status === 'completed' ? 'ok' : 'cancelled' },
    ),
  );
  return {
    runId,
    snapshot,
    completion,
    cancel() {
      if (!settled) controller.abort();
    },
  };
}

/** Prevents mutation of the shared completion result, including nested message data. */
function freezeResult<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const member of Object.values(value)) freezeResult(member);
    Object.freeze(value);
  }
  return value;
}
