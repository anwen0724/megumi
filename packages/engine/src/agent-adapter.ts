/* Adapts one Engine Run's product services to the provider-neutral stateful Agent interface. */
import {
  Agent,
  type AgentContext,
  type AgentContextProvider,
  type AgentError,
  type AgentEvent,
  type AgentExecutionResult,
  type AgentTool,
  type AgentToolResult,
} from '@megumi/agent';
import {
  createAssistantMessageEventStream,
  isContextOverflow,
  isRetryableAssistantError,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type JsonValue,
  type Models,
  type ToolResultMessage,
} from '@megumi/ai';
import type { ContextCapabilities, RunContext } from '@megumi/context';
import type { EventBus, EventPayloadByType, EventType } from '@megumi/events';
import type { UserInput } from '@megumi/input';
import type { ObservabilityService } from '@megumi/observability';
import type {
  ApprovalDecision,
  ApprovalSubject,
  PermissionDecision,
  PermissionOperation,
  Permissions,
} from '@megumi/permissions';
import type {
  AssistantReplyReasonCode,
  SessionAssistantContent,
  SessionEntry,
  SessionHistory,
} from '@megumi/session';
import type {
  ToolDefinition,
  ToolExecutionAccess,
  ToolExecutionNotification,
  ToolIdentity,
  ToolInvocation,
  Tools,
} from '@megumi/tools';
import { createLoopObserver, type LoopObserver } from './loop-observer';
import type { Run, RunApproval, RunClock, RunFailure, RunFailureCause } from './run';
import type { RunPolicy } from './run-policy';
import { toAgentPolicy } from './run-policy';
import type { ApprovalResolution } from './run-registry';
import {
  createSessionMessageCommitter,
  type AssistantReplyMetadata,
  type SessionMessageCommitter,
  type SessionToolResultCommit,
} from './session-message-committer';

export interface EngineAgentRunInput {
  readonly run: Run;
  readonly userInput: UserInput;
  readonly userEntry: SessionEntry;
  readonly transitionRunStatus: (status: 'waiting' | 'running') => void;
  readonly awaitApproval: (request: { readonly approval: RunApproval }) => Promise<ApprovalResolution>;
  readonly signal: AbortSignal;
}

export interface EngineAgentRunDependencies {
  readonly models: Models;
  readonly context: ContextCapabilities;
  readonly tools: Pick<
    Tools,
    'resolveModelCallTools' | 'routeToolCall' | 'executeToolInvocation' | 'releaseModelCallTools'
  >;
  readonly permissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly session: Pick<
    SessionHistory,
    'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'
  >;
  readonly events: EventBus;
  readonly observability?: ObservabilityService;
  readonly ids: {
    createModelCallId(): string;
    createToolExecutionId(): string;
    createRunApprovalId(): string;
    createSessionMessageId(): string;
  };
  readonly clock: RunClock;
  readonly policy: RunPolicy;
}

export type EngineAgentRunResult =
  | { readonly status: 'completed'; readonly assistantMessageId: string }
  | { readonly status: 'failed'; readonly failure: RunFailure }
  | { readonly status: 'cancelled' };

interface ToolScope {
  readonly modelCallId: string;
  readonly definitions: readonly ToolDefinition[];
  readonly tools: readonly AgentTool[];
  released: boolean;
}

interface TurnState {
  readonly modelCallId: string;
  readonly messageId: string;
  assistant?: AssistantMessage;
  messageStarted: boolean;
  attemptNumber: number;
  previousTerminal?: AssistantMessage;
  retryAttempts: number[];
  readonly attemptStartedAt: Map<number, string>;
  modelSpans: Array<ReturnType<LoopObserver['startSpan']>>;
  messageEnded: boolean;
  lastThinking: string;
}

type EngineToolUpdateDetails =
  | {
      readonly kind: 'execution_started';
      readonly toolExecutionId: string;
      readonly toolName: string;
      readonly arguments: unknown;
    }
  | { readonly kind: 'output'; readonly output: string }
  | { readonly kind: 'plan_updated'; readonly notification: ToolExecutionNotification };

interface EngineToolResultDetails {
  readonly kind: 'settled';
  readonly status: SessionToolResultCommit['status'];
  readonly content: string;
  readonly completedAt: string;
  readonly error?: { readonly code: string; readonly message: string };
  readonly summary?: string;
  readonly toolExecutionId?: string;
}

interface ToolRequestState {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly modelCallId: string;
}

class SessionCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionCommitError';
  }
}

interface AdapterRuntime {
  activeScope?: ToolScope;
  activeTurn?: TurnState;
  pendingFinalTurn?: TurnState;
  readonly toolRequests: Map<string, ToolRequestState>;
  readonly toolSystemFailures: Map<string, AgentError>;
  readonly committer: SessionMessageCommitter;
  readonly observer: LoopObserver;
}

export async function executeAgentRun(
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
): Promise<EngineAgentRunResult> {
  const runtime: AdapterRuntime = {
    toolRequests: new Map(),
    toolSystemFailures: new Map(),
    committer: createSessionMessageCommitter({
      userEntry: input.userEntry,
      session: dependencies.session,
      ids: dependencies.ids,
    }),
    observer: createLoopObserver({ run: input.run, observability: dependencies.observability }),
  };
  const contextProvider = createContextProvider(input, dependencies, runtime);
  const agent = new Agent({
    initialState: {
      configuration: {
        systemPrompt: '',
        model: input.run.model,
        thinkingLevel: input.run.model.reasoning ? 'high' : 'minimal',
        tools: [],
      },
      messages: [{
        role: 'user',
        content: [...input.userInput.modelContent],
        timestamp: timestampFrom(input.run.createdAt),
      }],
    },
    stream: createStreamAdapter(input, dependencies, runtime),
    context: contextProvider,
    policy: toAgentPolicy(dependencies.policy),
  });
  agent.subscribe((event) => handleAgentEvent(event, input, dependencies, runtime));
  const abortAgent = () => { agent.abort(); };
  input.signal.addEventListener('abort', abortAgent, { once: true });

  runtime.observer.start();
  let final: EngineAgentRunResult | undefined;
  try {
    const execution = agent.continue();
    if (input.signal.aborted) agent.abort();
    const result = await execution;
    finishRetryProjection(result, input, dependencies, runtime);
    final = await settleAgentResult(result, input, dependencies, runtime);
    return final;
  } catch (error) {
    if (input.signal.aborted) {
      final = await settleAgentResult(
        { status: 'cancelled', newMessages: [] },
        input,
        dependencies,
        runtime,
      );
      return final;
    }
    const failure = internalFailure(error);
    final = await settleFailedReply(failure, input, dependencies, runtime);
    return final;
  } finally {
    input.signal.removeEventListener('abort', abortAgent);
    releaseActiveScope(dependencies, runtime);
    runtime.observer.end(
      final?.status === 'completed' ? 'ok'
        : final?.status === 'cancelled' ? 'cancelled'
        : 'error',
    );
  }
}

function createContextProvider(
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): AgentContextProvider {
  const runContext: RunContext = {
    runId: input.run.runId,
    sessionId: input.run.sessionId,
    workspaceId: input.run.workspaceId,
    userInput: input.userInput,
    model: input.run.model,
  };

  const build = async (scope: ToolScope, signal: AbortSignal) => {
    try {
      const built = await dependencies.context.build({
        modelCallContext: {
          modelCallId: scope.modelCallId,
          run: runContext,
          tools: scope.definitions,
        },
        signal,
      });
      if (signal.aborted || (built.status === 'failed' && built.failure.code === 'cancelled')) {
        return { status: 'cancelled' as const };
      }
      if (built.status === 'failed') {
        return {
          status: 'failed' as const,
          error: contextAgentError(built.failure.message, built.failure.retryable, {
            owner: built.failure.cause?.owner ?? 'context',
            code: built.failure.cause?.code ?? built.failure.code,
          }),
        };
      }
      const context: AgentContext = {
        systemPrompt: built.prompt.systemPrompt,
        messages: [...built.prompt.messages],
        tools: scope.tools,
      };
      return { status: 'ready' as const, context };
    } catch (error) {
      if (signal.aborted) return { status: 'cancelled' as const };
      return {
        status: 'failed' as const,
        error: contextAgentError(
          error instanceof Error ? error.message : 'Context build failed.',
          false,
          { owner: 'context', code: 'context_build_threw' },
        ),
      };
    }
  };

  return {
    async prepare({ signal }) {
      releaseActiveScope(dependencies, runtime);
      const modelCallId = dependencies.ids.createModelCallId();
      let resolution;
      try {
        resolution = dependencies.tools.resolveModelCallTools({
          runId: input.run.runId,
          sessionId: input.run.sessionId,
          workspaceId: input.run.workspaceId,
          modelCallId,
        });
      } catch {
        safeReleaseModelCallTools(dependencies, runtime.observer, modelCallId);
        return {
          status: 'failed',
          error: contextAgentError('Tool registry is unavailable.', true, {
            owner: 'tools',
            code: 'tool_registry_unavailable',
          }),
        };
      }
      if (resolution.status === 'failed') {
        safeReleaseModelCallTools(dependencies, runtime.observer, modelCallId);
        return {
          status: 'failed',
          error: contextAgentError(resolution.failure.message, true, {
            owner: 'tools',
            code: resolution.failure.code,
          }),
        };
      }
      const scope: ToolScope = {
        modelCallId,
        definitions: resolution.definitions,
        tools: [],
        released: false,
      };
      (scope as { tools: readonly AgentTool[] }).tools = resolution.definitions.map((definition) => (
        createAgentTool(definition, scope, input, dependencies, runtime)
      ));
      runtime.activeScope = scope;
      const result = await build(scope, signal);
      if (result.status !== 'ready') releaseActiveScope(dependencies, runtime);
      return result;
    },

    async recoverOverflow({ signal }) {
      const scope = runtime.activeScope;
      if (!scope || scope.released) {
        return {
          status: 'failed',
          error: contextAgentError('ModelCall Tool scope is unavailable.', false, {
            owner: 'engine',
            code: 'model_call_scope_missing',
          }),
        };
      }
      const compacted = await dependencies.context.compact({
        sessionId: input.run.sessionId,
        workspaceId: input.run.workspaceId,
        model: input.run.model,
        tools: scope.definitions,
        trigger: 'overflow',
        signal,
      });
      if (signal.aborted || (compacted.status === 'failed' && compacted.failure.code === 'cancelled')) {
        return { status: 'cancelled' };
      }
      if (compacted.status !== 'compacted') {
        return {
          status: 'failed',
          error: contextAgentError(
            compacted.status === 'failed'
              ? compacted.failure.message
              : 'ModelCall overflowed and compaction had nothing to compact.',
            false,
            {
              owner: 'context',
              code: compacted.status === 'failed' ? compacted.failure.code : 'compaction_failed',
            },
          ),
        };
      }
      return build(scope, signal);
    },
  };
}

function createAgentTool(
  definition: ToolDefinition,
  scope: ToolScope,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): AgentTool {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters as AgentTool['parameters'],
    executionMode: definition.executionMode === 'serial' ? 'sequential' : 'parallel',
    execute: async ({ toolCallId, arguments: argumentsValue, signal, onUpdate }) => {
      const routed = dependencies.tools.routeToolCall({
        runId: input.run.runId,
        sessionId: input.run.sessionId,
        workspaceId: input.run.workspaceId,
        modelCallId: scope.modelCallId,
        toolCallId,
        toolName: definition.name,
        input: argumentsValue,
      });
      if (routed.status === 'failed') {
        return completedToolOutcome(settledToolResult({
          status: 'failure',
          content: routed.error.message,
          completedAt: dependencies.clock.now(),
          error: routed.error,
        }));
      }
      return executeRoutedTool(
        routed.invocation,
        routed.operations,
        signal,
        onUpdate,
        input,
        dependencies,
        runtime,
      );
    },
  };
}

async function executeRoutedTool(
  invocation: ToolInvocation,
  operations: readonly PermissionOperation[],
  signal: AbortSignal,
  onUpdate: (update: AgentToolResult) => void,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): Promise<ReturnType<AgentTool['execute']> extends Promise<infer T> ? T : never> {
  if (signal.aborted) return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
  let executionAccess: ToolExecutionAccess | undefined;
  if (operations.length > 0) {
    let permission;
    try {
      permission = await dependencies.permissions.evaluateToolCall({
        runId: input.run.runId,
        sessionId: input.run.sessionId,
        workspaceId: input.run.workspaceId,
        toolCallId: invocation.toolCallId,
        toolInput: snapshotValue(invocation.input) as JsonValue,
        operations,
        permissionMode: input.run.permissionMode,
        evaluatedAt: dependencies.clock.now(),
      });
    } catch {
      return systemToolFailure(
        runtime,
        invocation.toolCallId,
        'Permission evaluation failed.',
        'permissions',
        'permission_evaluation_threw',
      );
    }
    if (signal.aborted) return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
    if (permission.status === 'failed') {
      return systemToolFailure(
        runtime,
        invocation.toolCallId,
        permission.failure.message,
        'permissions',
        permission.failure.code,
      );
    }
    if (permission.decision.type === 'deny') {
      return completedToolOutcome(settledToolResult({
        status: 'permission_denied',
        content: permission.decision.reason,
        completedAt: dependencies.clock.now(),
        error: { code: permission.decision.denialCode, message: permission.decision.reason },
      }));
    }
    if (permission.decision.type === 'requires_approval') {
      const resolution = await requestApproval(
        invocation,
        permission.decision,
        signal,
        input,
        dependencies,
        runtime,
      );
      if (resolution.status === 'cancelled' || signal.aborted) {
        return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
      }
      const applied = await applyApprovalDecision(
        invocation,
        operations,
        permission.decision,
        permission.approvalSubject,
        resolution.decision,
        input,
        dependencies,
      );
      if (applied.status === 'failed') {
        return systemToolFailure(
          runtime,
          invocation.toolCallId,
          'Approval decision could not be applied.',
          'permissions',
          'approval_apply_failed',
        );
      }
      if (resolution.status === 'denied') {
        return completedToolOutcome(settledToolResult({
          status: 'user_rejected',
          content: 'Tool call was rejected by the user.',
          completedAt: dependencies.clock.now(),
          error: { code: 'user_rejected', message: 'Tool call was rejected by the user.' },
        }));
      }
      executionAccess = applied.executionAccess;
    } else {
      if (!permission.executionAccess) {
        return systemToolFailure(
          runtime,
          invocation.toolCallId,
          'Permission allow decision did not provide Tool execution access.',
          'permissions',
          'execution_access_missing',
        );
      }
      executionAccess = permission.executionAccess;
    }
  }
  return runToolInvocation(invocation, executionAccess, signal, onUpdate, dependencies, runtime);
}

async function runToolInvocation(
  invocation: ToolInvocation,
  executionAccess: ToolExecutionAccess | undefined,
  signal: AbortSignal,
  onUpdate: (update: AgentToolResult) => void,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): Promise<ReturnType<AgentTool['execute']> extends Promise<infer T> ? T : never> {
  if (signal.aborted) return completedToolOutcome(cancelledToolResult(dependencies.clock.now()));
  const toolExecutionId = dependencies.ids.createToolExecutionId();
  const span = runtime.observer.startSpan('tool.call', {
    modelCallId: invocation.modelCallId,
    toolCallId: invocation.toolCallId,
  });
  onUpdate({
    content: [],
    isError: false,
    details: {
      kind: 'execution_started',
      toolExecutionId,
      toolName: invocation.toolName,
      arguments: snapshotValue(invocation.input),
    } satisfies EngineToolUpdateDetails,
  });
  let accumulatedOutput = '';
  let closed: boolean = signal.aborted;
  signal.addEventListener('abort', () => { closed = true; }, { once: true });
  let execution;
  try {
    execution = await dependencies.tools.executeToolInvocation({
      invocation,
      toolExecutionId,
    }, {
      signal,
      onOutput: (output) => {
        if (closed) return;
        accumulatedOutput += output.chunk;
        onUpdate({
          content: [{ type: 'text', text: accumulatedOutput }],
          isError: false,
          details: { kind: 'output', output: accumulatedOutput } satisfies EngineToolUpdateDetails,
        });
      },
      onNotification: (notification) => {
        if (closed) return;
        onUpdate({
          content: [],
          isError: false,
          details: { kind: 'plan_updated', notification } satisfies EngineToolUpdateDetails,
        });
      },
      ...(executionAccess ? { executionAccess } : {}),
    });
  } catch {
    execution = undefined;
  }
  closed = true;
  const completedAt = dependencies.clock.now();
  if (!execution) {
    runtime.observer.endSpan(span, signal.aborted ? 'cancelled' : 'error');
    return completedToolOutcome(signal.aborted
      ? cancelledToolResult(completedAt, toolExecutionId)
      : settledToolResult({
        status: 'failure',
        content: 'Tool execution failed.',
        completedAt,
        toolExecutionId,
        error: { code: 'tool_execution_failed', message: 'Tool execution failed.' },
      }));
  }
  if (execution.type === 'succeeded') {
    runtime.observer.endSpan(span, 'ok');
    return completedToolOutcome(settledToolResult({
      status: 'success',
      content: execution.normalizedResult.content,
      completedAt,
      toolExecutionId,
      ...(execution.observation?.summary ? { summary: execution.observation.summary } : {}),
    }));
  }
  if (execution.error.code === 'tool_cancelled') {
    runtime.observer.endSpan(span, 'cancelled');
    return completedToolOutcome(cancelledToolResult(completedAt, toolExecutionId));
  }
  runtime.observer.endSpan(span, 'error');
  return completedToolOutcome(settledToolResult({
    status: 'failure',
    content: execution.normalizedResult.content,
    completedAt,
    toolExecutionId,
    error: execution.error,
  }));
}

async function requestApproval(
  invocation: ToolInvocation,
  decision: Extract<PermissionDecision, { type: 'requires_approval' }>,
  signal: AbortSignal,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): Promise<ApprovalResolution> {
  if (signal.aborted) return { status: 'cancelled' };
  const approval = createRunApproval(invocation, decision, input.run, dependencies);
  input.transitionRunStatus('waiting');
  const wait = input.awaitApproval({ approval });
  emitApprovalRequested(approval, input, dependencies);
  const span = runtime.observer.startSpan('approval.wait', {
    approvalId: approval.runApprovalId,
    toolCallId: approval.toolCallId,
  });
  const resolution = await wait;
  runtime.observer.endSpan(span, resolution.status === 'cancelled' ? 'cancelled' : 'ok');
  if (resolution.status !== 'cancelled') input.transitionRunStatus('running');
  emitApprovalResolved(approval, resolution, input, dependencies);
  return resolution;
}

async function applyApprovalDecision(
  invocation: ToolInvocation,
  operations: readonly PermissionOperation[],
  originalDecision: Extract<PermissionDecision, { type: 'requires_approval' }>,
  originalSubject: ApprovalSubject,
  decision: ApprovalDecision,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
): Promise<{ readonly status: 'applied'; readonly executionAccess?: ToolExecutionAccess } | { readonly status: 'failed' }> {
  try {
    const current = await dependencies.permissions.evaluateToolCall({
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      workspaceId: input.run.workspaceId,
      toolCallId: invocation.toolCallId,
      toolInput: snapshotValue(invocation.input) as JsonValue,
      operations,
      permissionMode: input.run.permissionMode,
      evaluatedAt: dependencies.clock.now(),
    });
    if (current.status === 'failed') return { status: 'failed' };
    const applied = await dependencies.permissions.applyApprovalDecision({
      originalPermissionDecision: originalDecision,
      originalSubject,
      currentSubject: current.approvalSubject,
      decision,
      sessionId: input.run.sessionId,
      appliedAt: dependencies.clock.now(),
      permissionMode: input.run.permissionMode,
    });
    if (applied.status !== 'applied') return { status: 'failed' };
    return {
      status: 'applied',
      ...(applied.executionAccess ? { executionAccess: applied.executionAccess } : {}),
    };
  } catch {
    return { status: 'failed' };
  }
}

function createStreamAdapter(
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): ConstructorParameters<typeof Agent>[0]['stream'] {
  return async (model, context, options) => {
    const turn = runtime.activeTurn;
    if (!turn) throw new Error('Model stream started outside an active Turn.');
    turn.attemptNumber += 1;
    const attemptNumber = turn.attemptNumber;
    turn.attemptStartedAt.set(attemptNumber, dependencies.clock.now());
    runtime.observer.recordMeasurement({
      name: 'model.call.attempt',
      value: attemptNumber,
      unit: 'count',
      attributes: { modelCallId: turn.modelCallId },
    });
    const previous = turn.previousTerminal;
    const overflowRecovery = previous
      ? isContextOverflow(previous, model.contextWindow)
      : false;
    if (attemptNumber > 1 && !overflowRecovery) {
      turn.retryAttempts.push(attemptNumber);
      emitRuntime(dependencies, input, 'turn.retry.started', {
        attemptNumber,
        retryKind: 'model_call',
      });
      runtime.observer.recordMeasurement({
        name: 'model.call.retry',
        value: 1,
        unit: 'count',
        attributes: { modelCallId: turn.modelCallId, attemptNumber },
      });
    }
    const span = runtime.observer.startSpan('model.call', {
      modelCallId: turn.modelCallId,
      attemptNumber,
    });
    turn.modelSpans.push(span);
    const source = await dependencies.models.streamSimple(model, context, {
      ...options,
      ...(model.reasoning && options.reasoning ? { reasoning: options.reasoning } : {}),
      maxRetries: dependencies.policy.providerRequestMaxRetries,
      maxRetryDelayMs: dependencies.policy.providerRequestMaxRetryDelayMs,
    });
    const wrapped = createAssistantMessageEventStream();
    void pumpStream(source, wrapped, model, attemptNumber, input, dependencies, runtime, span);
    return wrapped;
  };
}

async function pumpStream(
  source: AssistantMessageEventStream,
  target: AssistantMessageEventStream,
  model: EngineAgentRunInput['run']['model'],
  attemptNumber: number,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
  span: ReturnType<LoopObserver['startSpan']>,
): Promise<void> {
  let terminal: AssistantMessage | undefined;
  try {
    for await (const event of source) {
      target.push(event);
      if (event.type === 'done') terminal = event.message;
      if (event.type === 'error') terminal = event.error;
    }
  } catch (error) {
    terminal = failedAssistantMessage(
      model,
      error instanceof Error ? error.message : 'Model stream failed.',
    );
    target.push({ type: 'error', reason: 'error', error: terminal });
  } finally {
    if (terminal) recordAttemptTerminal(terminal, attemptNumber, input, dependencies, runtime);
    runtime.observer.endSpan(
      span,
      terminal?.stopReason === 'aborted' ? 'cancelled'
        : terminal?.stopReason === 'error' || !terminal ? 'error'
        : 'ok',
    );
    target.end(terminal);
  }
}

function recordAttemptTerminal(
  terminal: AssistantMessage,
  attemptNumber: number,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): void {
  const turn = runtime.activeTurn;
  if (!turn || turn.attemptNumber !== attemptNumber) return;
  turn.previousTerminal = terminal;
  const startedAt = turn.attemptStartedAt.get(attemptNumber) ?? dependencies.clock.now();
  const durationMs = Math.max(0, Date.parse(dependencies.clock.now()) - Date.parse(startedAt));
  runtime.observer.recordLog({
    level: 'info',
    event: 'model.call.attempt.finished',
    attributes: {
      modelCallId: turn.modelCallId,
      attemptNumber,
      stopReason: terminal.stopReason,
      inputTokens: terminal.usage.input,
      outputTokens: terminal.usage.output,
      durationMs,
    },
  });
  runtime.observer.recordMeasurement({
    name: 'model.call.usage',
    value: terminal.usage.input + terminal.usage.output,
    unit: 'token',
    attributes: {
      modelCallId: turn.modelCallId,
      attemptNumber,
      inputTokens: terminal.usage.input,
      outputTokens: terminal.usage.output,
    },
  });
  runtime.observer.recordMeasurement({
    name: 'model.call.duration_ms',
    value: durationMs,
    unit: 'ms',
    attributes: { modelCallId: turn.modelCallId, attemptNumber },
  });
  if (turn.retryAttempts.length === 0) return;
  const succeeded = terminal.stopReason === 'stop'
    || terminal.stopReason === 'toolUse'
    || terminal.stopReason === 'deferred';
  if (succeeded) {
    publishRetryCompleted(turn, input, dependencies, runtime);
    return;
  }
  const retryable = terminal.stopReason === 'length'
    || (terminal.stopReason === 'error' && isRetryableAssistantError(terminal));
  if (!retryable || attemptNumber >= dependencies.policy.maxModelCallAttempts) {
    publishRetryFailed(turn, terminal.errorMessage ?? 'Model call failed.', input, dependencies, runtime);
  }
}

async function handleAgentEvent(
  event: AgentEvent,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): Promise<void> {
  switch (event.type) {
    case 'turn_start': {
      const scope = runtime.activeScope;
      if (!scope) throw new Error('Turn started without a ModelCall Tool scope.');
      const turn: TurnState = {
        modelCallId: scope.modelCallId,
        messageId: dependencies.ids.createSessionMessageId(),
        messageStarted: false,
        attemptNumber: 0,
        retryAttempts: [],
        attemptStartedAt: new Map(),
        modelSpans: [],
        messageEnded: false,
        lastThinking: '',
      };
      runtime.activeTurn = turn;
      emitRuntime(dependencies, input, 'turn.started', { messageId: turn.messageId });
      break;
    }
    case 'message_start':
      if (event.message.role === 'assistant' && runtime.activeTurn) {
        runtime.activeTurn.messageStarted = true;
        emitRuntime(dependencies, input, 'message.started', {
          role: 'assistant',
          messageId: runtime.activeTurn.messageId,
        });
      }
      break;
    case 'message_update':
      publishAssistantProjection(event.message, input, dependencies, runtime);
      break;
    case 'message_end':
      if (event.message.role === 'assistant' && runtime.activeTurn) {
        runtime.activeTurn.assistant = event.message;
        if (toolCallIds(event.message).length > 0) {
          publishMessageEnded(
            event.message,
            runtime.activeTurn.messageId,
            input,
            dependencies,
          );
          runtime.activeTurn.messageEnded = true;
        }
      }
      break;
    case 'tool_execution_start': {
      const modelCallId = runtime.activeTurn?.modelCallId ?? runtime.activeScope?.modelCallId;
      if (!modelCallId) break;
      runtime.toolRequests.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        arguments: event.arguments,
        modelCallId,
      });
      emitRuntime(dependencies, input, 'tool_execution.requested', {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: toRecord(event.arguments),
        modelCallId,
      });
      break;
    }
    case 'tool_execution_update':
      publishToolUpdate(event.toolCallId, event.update, input, dependencies);
      break;
    case 'tool_execution_end':
      publishToolEnd(event.toolCallId, event.result, input, dependencies, runtime);
      break;
    case 'turn_end':
      await settleTurn(event.message, event.toolResults, input, dependencies, runtime);
      break;
    case 'agent_end':
      releaseActiveScope(dependencies, runtime);
      break;
    default:
      break;
  }
}

async function settleTurn(
  message: AssistantMessage,
  toolResults: readonly ToolResultMessage[],
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): Promise<void> {
  const turn = runtime.activeTurn;
  if (!turn) throw new Error('Turn ended without an active Turn.');
  turn.assistant = message;
  try {
    if (toolResults.length === 0 && toolCallIds(message).length === 0) {
      runtime.pendingFinalTurn = turn;
      runtime.activeTurn = undefined;
      return;
    }
    if (toolResults.length === 0) {
      emitRuntime(dependencies, input, 'turn.ended', {
        stopReason: 'error',
        messageId: turn.messageId,
        toolCallIds: toolCallIds(message),
      });
      runtime.activeTurn = undefined;
      return;
    }
    const response = await runtime.committer.commitModelResponse({
      sessionId: input.run.sessionId,
      runId: input.run.runId,
      messageId: turn.messageId,
      content: toAssistantContent(message),
      stopReason: message.stopReason,
      metadata: assistantMetadata(message),
      completedAt: dependencies.clock.now(),
    });
    if (response.status === 'failed') throw new SessionCommitError(response.failure.message);
    if (!turn.messageEnded) publishMessageEnded(message, response.messageId, input, dependencies);

    const commits = toolResults.map((result, callOrder) => toToolResultCommit(
      result,
      callOrder,
      input.signal.aborted,
      dependencies.clock.now(),
      runtime,
    ));
    const committed = await runtime.committer.commitToolResults({
      sessionId: input.run.sessionId,
      runId: input.run.runId,
      results: commits,
    });
    const commitById = new Map(commits.map((item) => [item.toolCallId, item]));
    for (const item of committed.items) {
      const commit = commitById.get(item.toolCallId);
      emitRuntime(dependencies, input, 'message.started', {
        role: 'tool_result',
        messageId: item.messageId,
      });
      emitRuntime(dependencies, input, 'message.ended', {
        role: 'tool_result',
        messageId: item.messageId,
        content: commit?.content ?? '',
      });
    }
    if (committed.status === 'failed') throw new SessionCommitError(committed.failure.message);
    emitRuntime(dependencies, input, 'turn.ended', {
      stopReason: input.signal.aborted ? 'cancelled' : 'tool_calls',
      messageId: response.messageId,
      toolCallIds: toolResults.map((result) => result.toolCallId),
    });
    runtime.activeTurn = undefined;
  } catch (error) {
    if (!turn.messageEnded) {
      publishMessageEnded(message, turn.messageId, input, dependencies);
      turn.messageEnded = true;
    }
    emitRuntime(dependencies, input, 'turn.ended', {
      stopReason: 'error',
      messageId: turn.messageId,
      toolCallIds: toolCallIds(message),
    });
    runtime.activeTurn = undefined;
    throw error;
  } finally {
    releaseActiveScope(dependencies, runtime);
  }
}

async function settleAgentResult(
  result: AgentExecutionResult,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): Promise<EngineAgentRunResult> {
  if (result.status === 'completed') {
    const reply = await commitFinalReply(
      'completed',
      toAssistantContent(result.finalMessage),
      'normal_completion',
      result.finalMessage,
      input,
      dependencies,
      runtime,
    );
    return reply.status === 'failed'
      ? reply
      : { status: 'completed', assistantMessageId: reply.assistantMessageId };
  }
  if (result.status === 'cancelled') {
    const partial = lastAssistant(result.newMessages);
    const reply = await commitFinalReply(
      'cancelled',
      partial ? toAssistantContent(partial) : [],
      'user_cancelled',
      partial,
      input,
      dependencies,
      runtime,
    );
    return reply.status === 'failed' ? reply : { status: 'cancelled' };
  }
  const failure = agentFailure(result.error);
  const partial = lastAssistant(result.newMessages);
  return settleFailedReply(
    failure,
    input,
    dependencies,
    runtime,
    partial?.stopReason === 'toolUse' ? undefined : partial,
  );
}

async function settleFailedReply(
  failure: RunFailure,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
  partial?: AssistantMessage,
): Promise<EngineAgentRunResult> {
  const turn = runtime.activeTurn ?? runtime.pendingFinalTurn;
  if (turn) {
    const lifecycleMessage = turn.assistant ?? partial;
    if (turn.messageStarted && !turn.messageEnded && lifecycleMessage) {
      publishMessageEnded(lifecycleMessage, turn.messageId, input, dependencies);
      turn.messageEnded = true;
    }
    emitRuntime(dependencies, input, 'turn.ended', {
      stopReason: 'error',
      messageId: turn.messageId,
      toolCallIds: lifecycleMessage ? toolCallIds(lifecycleMessage) : [],
    });
    runtime.activeTurn = undefined;
    runtime.pendingFinalTurn = undefined;
    releaseActiveScope(dependencies, runtime);
  }
  if (failure.code === 'session_failed') return { status: 'failed', failure };
  const reply = await commitFinalReply(
    'failed',
    [],
    failureReason(failure),
    undefined,
    input,
    dependencies,
    runtime,
  );
  return reply.status === 'failed' ? reply : { status: 'failed', failure };
}

async function commitFinalReply(
  status: 'completed' | 'failed' | 'cancelled',
  content: readonly SessionAssistantContent[],
  reasonCode: AssistantReplyReasonCode,
  message: AssistantMessage | undefined,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): Promise<
  | { readonly status: 'saved'; readonly assistantMessageId: string }
  | { readonly status: 'failed'; readonly failure: RunFailure }
> {
  const turn = runtime.pendingFinalTurn ?? runtime.activeTurn;
  const reply = await runtime.committer.commitAssistantReply({
    sessionId: input.run.sessionId,
    runId: input.run.runId,
    status,
    content,
    reasonCode,
    ...(turn ? { messageId: turn.messageId } : {}),
    ...(message ? { metadata: assistantMetadata(message) } : {}),
    completedAt: dependencies.clock.now(),
  });
  if (reply.status === 'failed') {
    if (turn?.messageStarted && !turn.messageEnded && turn.assistant) {
      publishMessageEnded(turn.assistant, turn.messageId, input, dependencies);
      turn.messageEnded = true;
    }
    if (turn) {
      emitRuntime(dependencies, input, 'turn.ended', {
        stopReason: 'error',
        messageId: turn.messageId,
        toolCallIds: turn.assistant ? toolCallIds(turn.assistant) : [],
      });
    }
    return { status: 'failed', failure: sessionFailure(reply.failure.message) };
  }
  if (!turn?.messageStarted) {
    emitRuntime(dependencies, input, 'message.started', {
      role: 'assistant',
      messageId: reply.messageId,
    });
  }
  emitRuntime(dependencies, input, 'message.ended', {
    role: 'assistant',
    messageId: reply.messageId,
    content: assistantText(content),
  });
  if (turn) {
    emitRuntime(dependencies, input, 'turn.ended', {
      stopReason: status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'error',
      messageId: reply.messageId,
      toolCallIds: message ? toolCallIds(message) : [],
    });
  }
  runtime.pendingFinalTurn = undefined;
  runtime.activeTurn = undefined;
  return { status: 'saved', assistantMessageId: reply.messageId };
}

function publishAssistantProjection(
  message: AssistantMessage,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): void {
  const turn = runtime.activeTurn;
  if (!turn) return;
  const content = toAssistantContent(message);
  const thinking = content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('');
  emitRuntime(dependencies, input, 'message.update', {
    role: 'assistant',
    messageId: turn.messageId,
    content: assistantText(content),
  });
  if (thinking && thinking !== turn.lastThinking) {
    turn.lastThinking = thinking;
    emitRuntime(dependencies, input, 'message.thinking.update', {
      messageId: turn.messageId,
      thinking,
    });
  }
}

function publishToolUpdate(
  toolCallId: string,
  update: AgentToolResult,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
): void {
  const details = update.details as EngineToolUpdateDetails | undefined;
  if (!details) return;
  if (details.kind === 'execution_started') {
    emitRuntime(dependencies, input, 'tool_execution.started', {
      toolCallId,
      toolName: details.toolName,
      args: toRecord(details.arguments),
      toolExecutionId: details.toolExecutionId,
    });
    return;
  }
  if (details.kind === 'output') {
    emitRuntime(dependencies, input, 'tool_execution.update', {
      toolCallId,
      output: details.output,
    });
    return;
  }
  emitRuntime(dependencies, input, 'tool_execution.plan_updated', {
    toolCallId,
    ...(details.notification.explanation ? { explanation: details.notification.explanation } : {}),
    plan: details.notification.plan.map((step) => ({ step: step.step, status: step.status })),
  });
}

function publishToolEnd(
  toolCallId: string,
  result: AgentToolResult,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): void {
  const details = result.details as EngineToolResultDetails | undefined;
  if (!details) {
    const systemFailure = runtime.toolSystemFailures.get(toolCallId);
    emitRuntime(dependencies, input, 'tool_execution.ended', {
      toolCallId,
      status: input.signal.aborted ? 'cancelled' : 'failed',
      ...(input.signal.aborted ? {} : {
        error: {
          message: systemFailure?.message ?? toolResultText(result),
          code: systemFailure ? 'run_failed_before_tool_result' : 'tool_execution_failed',
        },
      }),
    });
    return;
  }
  if (details.status === 'success') {
    emitRuntime(dependencies, input, 'tool_execution.ended', {
      toolCallId,
      ...(details.toolExecutionId ? { toolExecutionId: details.toolExecutionId } : {}),
      status: 'completed',
      result: details.content,
      ...(details.summary ? { summary: details.summary } : {}),
    });
    return;
  }
  if (details.status === 'permission_denied' || details.status === 'user_rejected') {
    emitRuntime(dependencies, input, 'tool_execution.ended', {
      toolCallId,
      status: 'denied',
    });
    return;
  }
  if (details.status === 'cancelled') {
    emitRuntime(dependencies, input, 'tool_execution.ended', {
      toolCallId,
      ...(details.toolExecutionId ? { toolExecutionId: details.toolExecutionId } : {}),
      status: 'cancelled',
    });
    return;
  }
  emitRuntime(dependencies, input, 'tool_execution.ended', {
    toolCallId,
    ...(details.toolExecutionId ? { toolExecutionId: details.toolExecutionId } : {}),
    status: 'failed',
    error: {
      message: details.error?.message ?? details.content,
      ...(details.error?.code ? { code: details.error.code } : {}),
    },
  });
}

function toToolResultCommit(
  result: ToolResultMessage,
  callOrder: number,
  aborted: boolean,
  fallbackCompletedAt: string,
  runtime: AdapterRuntime,
): SessionToolResultCommit {
  const details = result.details as EngineToolResultDetails | undefined;
  const systemFailure = runtime.toolSystemFailures.get(result.toolCallId);
  return {
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    callOrder,
    status: details?.status ?? (aborted ? 'cancelled' : 'failure'),
    ...(details?.error ? { error: details.error } : result.isError
      ? {
          error: {
            code: aborted ? 'tool_cancelled'
              : systemFailure ? 'run_failed_before_tool_result'
              : 'tool_execution_failed',
            message: systemFailure?.message ?? toolResultText(result),
          },
        }
      : {}),
    content: details?.content ?? toolResultText(result),
    completedAt: details?.completedAt ?? fallbackCompletedAt,
  };
}

function completedToolOutcome(result: AgentToolResult<EngineToolResultDetails>) {
  return { status: 'completed' as const, result };
}

function settledToolResult(
  input: Omit<EngineToolResultDetails, 'kind'>,
): AgentToolResult<EngineToolResultDetails> {
  const details: EngineToolResultDetails = { kind: 'settled', ...input };
  return {
    content: [{ type: 'text', text: input.content }],
    isError: input.status !== 'success',
    details,
  };
}

function cancelledToolResult(
  completedAt: string,
  toolExecutionId?: string,
): AgentToolResult<EngineToolResultDetails> {
  return settledToolResult({
    status: 'cancelled',
    content: 'Tool call was cancelled.',
    completedAt,
    error: { code: 'tool_cancelled', message: 'Tool call was cancelled.' },
    ...(toolExecutionId ? { toolExecutionId } : {}),
  });
}

function systemToolFailure(
  runtime: AdapterRuntime,
  toolCallId: string,
  message: string,
  owner: 'permissions' | 'tools',
  code: string,
) {
  const error = {
    code: 'tool_system_failed' as const,
    message,
    retryable: false,
    cause: { owner, code },
  };
  runtime.toolSystemFailures.set(toolCallId, error);
  return {
    status: 'system_failed' as const,
    error,
  };
}

function createRunApproval(
  invocation: ToolInvocation,
  decision: Extract<PermissionDecision, { type: 'requires_approval' }>,
  run: Run,
  dependencies: EngineAgentRunDependencies,
): RunApproval {
  return {
    runApprovalId: dependencies.ids.createRunApprovalId(),
    runId: run.runId,
    toolCallId: invocation.toolCallId,
    toolName: invocation.toolName,
    toolIdentity: snapshotToolIdentity(invocation.toolIdentity),
    input: snapshotValue(invocation.input),
    operations: decision.operations.map((operation) => snapshotValue(operation) as PermissionOperation),
    options: decision.options,
    defaultOptionId: decision.defaultOptionId,
    summary: `${invocation.toolName} requires approval.`,
    createdAt: dependencies.clock.now(),
    status: 'pending',
  };
}

function emitApprovalRequested(
  approval: RunApproval,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
): void {
  emitRuntime(dependencies, input, 'approval.requested', {
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
    toolIdentity: {
      sourceId: approval.toolIdentity.sourceId,
      namespace: approval.toolIdentity.namespace,
      sourceToolName: approval.toolIdentity.sourceToolName,
    },
    reason: approval.summary ?? `Approve ${approval.toolName}`,
    args: toRecord(approval.input),
    operations: approval.operations.map(toRecord),
    approvalRequestId: approval.runApprovalId,
    options: approval.options.map((option) => ({
      optionId: option.optionId,
      scope: option.scope,
      label: option.display.label,
      description: option.display.description,
    })),
    defaultOptionId: approval.defaultOptionId,
  });
}

function emitApprovalResolved(
  approval: RunApproval,
  resolution: ApprovalResolution,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
): void {
  const decision = resolution.status;
  emitRuntime(dependencies, input, 'approval.resolved', {
    approvalRequestId: approval.runApprovalId,
    toolCallId: approval.toolCallId,
    decision,
    ...(decision === 'approved' && resolution.decision.decision === 'approved'
      ? { optionId: resolution.decision.optionId }
      : {}),
    decidedAt: dependencies.clock.now(),
  });
}

function emitRuntime<TType extends EventType>(
  dependencies: EngineAgentRunDependencies,
  input: EngineAgentRunInput,
  type: TType,
  payload: EventPayloadByType[TType],
): void {
  try {
    dependencies.events.publish({
      type,
      payload,
      sessionId: input.run.sessionId,
      runId: input.run.runId,
    });
  } catch {
    // Runtime Events are best-effort and never own the Run outcome.
  }
}

function releaseActiveScope(
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): void {
  const scope = runtime.activeScope;
  if (!scope || scope.released) return;
  scope.released = true;
  runtime.activeScope = undefined;
  safeReleaseModelCallTools(dependencies, runtime.observer, scope.modelCallId);
}

function safeReleaseModelCallTools(
  dependencies: EngineAgentRunDependencies,
  observer: LoopObserver,
  modelCallId: string,
): void {
  try {
    dependencies.tools.releaseModelCallTools({ modelCallId });
  } catch (error) {
    observer.recordLog({
      level: 'error',
      event: 'tool.router.release_failed',
      attributes: {
        modelCallId,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function finishRetryProjection(
  result: AgentExecutionResult,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): void {
  const turn = runtime.activeTurn ?? runtime.pendingFinalTurn;
  if (!turn || turn.retryAttempts.length === 0) return;
  if (result.status === 'completed') publishRetryCompleted(turn, input, dependencies, runtime);
  else {
    publishRetryFailed(
      turn,
      result.status === 'failed' ? result.error.message : 'Model call was cancelled.',
      input,
      dependencies,
      runtime,
    );
  }
}

function publishRetryCompleted(
  turn: TurnState,
  input: EngineAgentRunInput | undefined,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): void {
  if (input) {
    for (const attemptNumber of turn.retryAttempts) {
      emitRuntime(dependencies, input, 'turn.retry.completed', { attemptNumber });
      runtime.observer.recordLog({
        level: 'info',
        event: 'model.call.retry.completed',
        attributes: { retryAttemptNumber: attemptNumber },
      });
    }
  }
  turn.retryAttempts = [];
}

function publishRetryFailed(
  turn: TurnState,
  message: string,
  input: EngineAgentRunInput | undefined,
  dependencies: EngineAgentRunDependencies,
  runtime: AdapterRuntime,
): void {
  if (input) {
    for (const attemptNumber of turn.retryAttempts) {
      emitRuntime(dependencies, input, 'turn.retry.failed', {
        attemptNumber,
        error: { message, code: 'model_call_failed' },
      });
      runtime.observer.recordLog({
        level: 'warn',
        event: 'model.call.retry.failed',
        attributes: { retryAttemptNumber: attemptNumber },
      });
    }
  }
  turn.retryAttempts = [];
}

function agentFailure(error: AgentError): RunFailure {
  const cause = agentCause(error.cause);
  if (error.code === 'event_listener_failed' && error.cause instanceof SessionCommitError) {
    return sessionFailure(error.cause.message);
  }
  if (error.code === 'context_failed') {
    return { code: 'context_failed', message: error.message, retryable: error.retryable, cause };
  }
  if (error.code === 'model_call_failed') {
    return {
      code: 'model_call_failed',
      message: error.message,
      retryable: error.retryable,
      cause: cause ?? { owner: 'ai', code: 'model_call_failed' },
    };
  }
  if (error.code === 'tool_system_failed') {
    return {
      code: cause?.owner === 'permissions' ? 'permission_failed' : 'tool_system_failed',
      message: error.message,
      retryable: error.retryable,
      cause: cause ?? { owner: 'tools', code: 'tool_system_failed' },
    };
  }
  if (error.code === 'execution_limit_reached') {
    return {
      code: 'loop_limit_exceeded',
      message: error.message,
      retryable: false,
      cause: { owner: 'engine', code: 'loop_limit_exceeded' },
    };
  }
  return {
    code: 'internal_error',
    message: error.message,
    retryable: false,
    cause: cause ?? { owner: 'engine', code: error.code },
  };
}

function agentCause(value: unknown): RunFailureCause | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const owner = (value as { owner?: unknown }).owner;
  const code = (value as { code?: unknown }).code;
  const owners: RunFailureCause['owner'][] = [
    'ai', 'context', 'permissions', 'tools', 'session', 'skills', 'workspace', 'instructions', 'engine',
  ];
  return typeof owner === 'string' && owners.includes(owner as RunFailureCause['owner']) && typeof code === 'string'
    ? { owner: owner as RunFailureCause['owner'], code }
    : undefined;
}

function contextAgentError(
  message: string,
  retryable: boolean,
  cause: { readonly owner: string; readonly code: string },
): AgentError {
  return { code: 'context_failed', message, retryable, cause };
}

function sessionFailure(message: string): RunFailure {
  return {
    code: 'session_failed',
    message,
    retryable: false,
    cause: { owner: 'session', code: 'session_failed' },
  };
}

function internalFailure(error: unknown): RunFailure {
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'Engine Agent Adapter failed.',
    retryable: false,
    cause: { owner: 'engine', code: 'agent_adapter_failed' },
  };
}

function failureReason(failure: RunFailure): AssistantReplyReasonCode {
  if (
    failure.code === 'session_failed'
    || failure.code === 'context_failed'
    || failure.code === 'model_call_failed'
    || failure.code === 'loop_limit_exceeded'
    || failure.code === 'runtime_protocol_violation'
  ) return failure.code;
  if (failure.code === 'permission_failed') return 'approval_failed';
  if (failure.code === 'tool_system_failed') return 'tool_call_failed';
  return 'internal_error';
}

function toAssistantContent(message: AssistantMessage): SessionAssistantContent[] {
  return message.content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking };
    return {
      type: 'toolCall',
      id: block.id,
      name: block.name,
      arguments: block.arguments as Record<string, unknown>,
    };
  });
}

function assistantMetadata(message: AssistantMessage): AssistantReplyMetadata {
  return {
    api: message.api,
    provider: message.provider,
    model: message.model,
    ...(message.responseModel ? { response_model: message.responseModel } : {}),
    ...(message.responseId ? { response_id: message.responseId } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.errorMessage ? { error_message: message.errorMessage } : {}),
  };
}

function publishMessageEnded(
  message: AssistantMessage,
  messageId: string,
  input: EngineAgentRunInput,
  dependencies: EngineAgentRunDependencies,
): void {
  emitRuntime(dependencies, input, 'message.ended', {
    role: 'assistant',
    messageId,
    content: assistantText(toAssistantContent(message)),
  });
}

function assistantText(content: readonly SessionAssistantContent[]): string {
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('');
}

function toolCallIds(message: AssistantMessage): string[] {
  return message.content.filter((block) => block.type === 'toolCall').map((block) => block.id);
}

function lastAssistant(messages: readonly import('@megumi/agent').AgentMessage[]): AssistantMessage | undefined {
  return [...messages].reverse().find((message): message is AssistantMessage => message.role === 'assistant');
}

function toolResultText(result: Pick<ToolResultMessage, 'content'> | AgentToolResult): string {
  return result.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n');
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? snapshotValue(value) as Record<string, unknown>
    : {};
}

function snapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotValue(item)]));
  }
  return value;
}

function snapshotToolIdentity(identity: ToolIdentity): ToolIdentity {
  return { ...identity };
}

function timestampFrom(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function failedAssistantMessage(
  model: EngineAgentRunInput['run']['model'],
  message: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now(),
  };
}
