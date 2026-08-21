/* Provides the stateful public Agent interface over the execution-scoped Agent Loop. */
import { EventSinkFailure, runAgentLoop } from './agent-loop';
import type {
  AgentConfiguration,
  AgentConfigurationPatch,
  AgentError,
  AgentEvent,
  AgentEventListener,
  AgentExecutionOptions,
  AgentExecutionPhase,
  AgentExecutionProgress,
  AgentExecutionResult,
  AgentExecutionState,
  AgentMessage,
  AgentOperationErrorCode,
  AgentOptions,
  AgentPolicy,
  AgentState,
} from './types';

const DEFAULT_AGENT_POLICY: Readonly<AgentPolicy> = Object.freeze({
  maxModelCalls: 80,
  maxModelCallAttempts: 3,
  maxToolRounds: 50,
  maxToolCalls: 256,
  maxToolCallsPerModelCall: 32,
  maxConcurrentToolCalls: 4,
  modelCallTimeoutMs: 120_000,
  toolCallTimeoutMs: 120_000,
  modelRetryDelayMs: 1_000,
  maxContextOverflowRecoveries: 1,
});

/** Legal phase moves of one executing execution; settling only leads back to idle. */
const ALLOWED_PHASE_TRANSITIONS: Readonly<Record<AgentExecutionPhase, readonly AgentExecutionPhase[]>> = {
  preparing_context: ['calling_model', 'settling'],
  calling_model: ['executing_tools', 'preparing_context', 'settling'],
  executing_tools: ['preparing_context', 'settling'],
  settling: [],
};

interface ActiveExecution {
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
  readonly executionId: string;
}

export class AgentOperationError extends Error {
  readonly code: AgentOperationErrorCode;

  constructor(code: AgentOperationErrorCode, message = operationErrorMessage(code)) {
    super(message);
    this.name = 'AgentOperationError';
    this.code = code;
  }
}

export class Agent {
  private configuration: AgentConfiguration;
  private messages: AgentMessage[];
  private execution: AgentExecutionState = { status: 'idle' };
  private streamingMessage: AgentState['streamingMessage'];
  private pendingToolCallIds = new Set<string>();
  private lastError: AgentError | undefined;
  private readonly stream: AgentOptions['stream'];
  private readonly contextProvider: AgentOptions['context'];
  private readonly policy: AgentPolicy;
  private readonly settlement: AgentOptions['settlement'];
  private readonly listeners = new Set<AgentEventListener>();
  private activeExecution: ActiveExecution | undefined;
  /** Once the final result is fixed, abort() and late listener failures cannot change it. */
  private resultFixed = false;
  /** Serializes Agent-owned event publications so state facts stay ordered. */
  private publishChain: Promise<void> = Promise.resolve();

  constructor(options: AgentOptions) {
    this.configuration = copyConfiguration(options.initialState.configuration);
    this.messages = [...(options.initialState.messages ?? [])];
    this.stream = options.stream;
    this.contextProvider = options.context;
    this.policy = resolvePolicy(options.policy);
    this.settlement = options.settlement;
  }

  get state(): AgentState {
    return {
      configuration: copyConfiguration(this.configuration),
      messages: [...this.messages],
      execution: executionSnapshot(this.execution),
      ...(this.streamingMessage ? { streamingMessage: this.streamingMessage } : {}),
      pendingToolCallIds: new Set(this.pendingToolCallIds),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  configure(patch: AgentConfigurationPatch): void {
    this.assertIdleMutation();
    this.configuration = copyConfiguration({ ...this.configuration, ...patch });
  }

  replaceMessages(messages: readonly AgentMessage[]): void {
    this.assertIdleMutation();
    this.messages = [...messages];
  }

  async prompt(
    input: AgentMessage | readonly AgentMessage[],
    options?: AgentExecutionOptions,
  ): Promise<AgentExecutionResult> {
    this.assertCanStart();
    const messages = Array.isArray(input) ? [...input] : [input];
    if (messages.length === 0) {
      throw new AgentOperationError('invalid_state', 'Agent prompt requires at least one message.');
    }
    return this.execute(messages, options);
  }

  async continue(options?: AgentExecutionOptions): Promise<AgentExecutionResult> {
    this.assertCanStart();
    const lastMessage = this.messages.at(-1);
    if (!lastMessage || (lastMessage.role !== 'user' && lastMessage.role !== 'toolResult')) {
      throw new AgentOperationError(
        'invalid_state',
        'Agent can continue only when its history ends with a user or toolResult message.',
      );
    }
    return this.execute([], options);
  }

  abort(): void {
    const active = this.activeExecution;
    if (!active || this.resultFixed) return;
    active.controller.abort();
    const current = this.execution;
    // Executing -> cancelling with the same phase, turn and attempt; cancelling
    // is irreversible and the same root signal reaches every in-flight work.
    if (current.status === 'executing') {
      const cancelling: AgentExecutionState = { ...current, status: 'cancelling' };
      this.transition(cancelling);
      void this.enqueuePublish(async () => {
        await this.publishIsolated({
          type: 'execution_state_changed',
          previous: executionSnapshot(current),
          current: executionSnapshot(cancelling),
        });
      });
    }
  }

  waitForIdle(): Promise<void> {
    return this.activeExecution?.completion ?? Promise.resolve();
  }

  reset(): void {
    this.assertIdleMutation();
    this.messages = [];
    this.streamingMessage = undefined;
    this.pendingToolCallIds = new Set();
    this.lastError = undefined;
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private async execute(
    input: readonly AgentMessage[],
    options?: AgentExecutionOptions,
  ): Promise<AgentExecutionResult> {
    const executionId = resolveExecutionId(options?.executionId);
    const controller = new AbortController();
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    this.activeExecution = { controller, completion, resolveCompletion, executionId };
    this.resultFixed = false;
    this.streamingMessage = undefined;
    this.pendingToolCallIds = new Set();
    this.lastError = undefined;

    // 1. Accept the execution: idle -> executing.preparing_context, then run the Loop.
    let candidate: AgentExecutionResult;
    try {
      this.transition({
        status: 'executing',
        executionId,
        phase: 'preparing_context',
        turn: 1,
        attempt: 0,
      });
      await this.publishNecessary({
        type: 'execution_state_changed',
        previous: { status: 'idle' },
        current: executionSnapshot(this.execution),
      });
      candidate = await runAgentLoop({
        configuration: copyConfiguration(this.configuration),
        messages: [...this.messages],
        input: [...input],
        stream: this.stream,
        contextProvider: this.contextProvider,
        signal: controller.signal,
        policy: this.policy,
        executionId,
        report: this.reportProgress,
        emit: (event) => this.processEvent(event, controller.signal),
      });
    } catch (error) {
      candidate = failedResult(executionId, normalizeAgentFailure(error), []);
    }

    // 2. Settle: every exit path passes through settling exactly once. Listener
    // failures before the result is fixed revise the candidate; the settlement
    // seam then receives the candidate once.
    const beforeSettling = this.execution;
    if (beforeSettling.status === 'idle') {
      throw new Error('Agent Execution cannot settle from idle.');
    }
    const settlingState: AgentExecutionState = {
      status: beforeSettling.status,
      executionId: beforeSettling.executionId,
      phase: 'settling',
      turn: beforeSettling.turn,
      attempt: beforeSettling.attempt,
    };
    this.transition(settlingState);
    try {
      await this.publishNecessary({
        type: 'execution_state_changed',
        previous: executionSnapshot(beforeSettling),
        current: executionSnapshot(this.execution),
      });
    } catch (error) {
      candidate = failedResult(executionId, normalizeAgentFailure(error), candidate.newMessages);
    }
    try {
      await this.settlement?.(candidate, controller.signal);
    } catch (error) {
      candidate = failedResult(executionId, listenerFailure(error), candidate.newMessages);
    }
    // Cancellation wins every race: once the root signal is aborted the single
    // fixed result is cancelled, even when the settlement already succeeded.
    const finalResult: AgentExecutionResult = controller.signal.aborted
      ? { status: 'cancelled', executionId, newMessages: [...candidate.newMessages] }
      : candidate;
    this.resultFixed = true;
    this.lastError = finalResult.status === 'failed' ? finalResult.error : undefined;

    // 3. Publish the fixed result, clear the temporary projections, and return to idle.
    const settling = this.execution;
    await this.publishIsolated({ type: 'agent_end', executionId, result: finalResult });
    this.streamingMessage = undefined;
    this.pendingToolCallIds = new Set();
    this.transition({ status: 'idle' });
    await this.publishIsolated({
      type: 'execution_state_changed',
      previous: executionSnapshot(settling),
      current: { status: 'idle' },
    });

    const active = this.activeExecution;
    this.activeExecution = undefined;
    active?.resolveCompletion();
    return finalResult;
  }

  /** The Loop's only progress channel: validate, transition, then publish the state fact. */
  private readonly reportProgress = (progress: AgentExecutionProgress): Promise<void> => (
    this.enqueuePublish(async () => {
      const previous = this.execution;
      const next = this.applyProgress(progress);
      if (sameExecutionState(previous, next)) return;
      this.transition(next);
      await this.publishNecessary({
        type: 'execution_state_changed',
        previous: executionSnapshot(previous),
        current: executionSnapshot(next),
      });
    })
  );

  private applyProgress(progress: AgentExecutionProgress): AgentExecutionState {
    const current = this.execution;
    if (current.status === 'idle') {
      throw new Error('Agent execution progress cannot be reported while idle.');
    }
    const phase = progress.phase ?? current.phase;
    const turn = progress.turn ?? current.turn;
    const attempt = progress.attempt ?? current.attempt;
    if (!Number.isInteger(turn) || turn < 1 || turn < current.turn) {
      throw new Error(`Invalid Agent execution turn progress: ${turn}.`);
    }
    if (progress.attempt !== undefined && (!Number.isInteger(progress.attempt) || progress.attempt < 1)) {
      throw new Error(`Invalid Agent execution attempt progress: ${progress.attempt}.`);
    }
    if (progress.attempt !== undefined && phase !== 'calling_model') {
      throw new Error('Agent execution attempt can only be reported during calling_model.');
    }
    return { ...current, phase, turn, attempt };
  }

  /** The single transition implementation: illegal moves fail loudly in development. */
  private transition(next: AgentExecutionState): void {
    const current = this.execution;
    if (current.status === 'idle') {
      if (next.status !== 'executing' || next.phase !== 'preparing_context' || next.turn !== 1 || next.attempt !== 0) {
        throw new Error(`Invalid Agent Execution transition from idle to ${describeState(next)}.`);
      }
      this.execution = next;
      return;
    }
    if (next.status === 'idle') {
      if (current.phase !== 'settling') {
        throw new Error('Agent can only return to idle from settling.');
      }
      this.execution = next;
      return;
    }
    if (next.executionId !== current.executionId) {
      throw new Error('Agent executionId must stay stable during one Agent Execution.');
    }
    if (next.status === 'executing') {
      if (current.status !== 'executing') {
        throw new Error('A cancelling Agent Execution cannot return to executing.');
      }
      if (next.phase !== current.phase) {
        this.assertPhaseMove(current.phase, next.phase);
      }
      if (next.phase === 'settling' && (next.turn !== current.turn || next.attempt !== current.attempt)) {
        throw new Error('Settling preserves the current turn and attempt.');
      }
      this.execution = next;
      return;
    }
    if (next.status === 'cancelling') {
      if (current.status === 'executing') {
        if (next.phase !== current.phase || next.turn !== current.turn || next.attempt !== current.attempt) {
          throw new Error('Cancelling preserves the current execution facts.');
        }
        this.execution = next;
        return;
      }
      // cancelling keeps moving along the same phase graph until settling.
      if (next.phase !== current.phase) {
        this.assertPhaseMove(current.phase, next.phase);
      }
      if (next.phase === 'settling' && (next.turn !== current.turn || next.attempt !== current.attempt)) {
        throw new Error('Settling preserves the current turn and attempt.');
      }
      this.execution = next;
      return;
    }
    throw new Error(`Invalid Agent Execution transition to ${describeState(next)}.`);
  }

  private assertPhaseMove(from: AgentExecutionPhase, to: AgentExecutionPhase): void {
    const allowed = ALLOWED_PHASE_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid Agent Execution phase transition from ${from} to ${to}.`);
    }
  }

  /** Publishes one pre-final event; listener failures fail the execution loudly. */
  private async publishNecessary(event: AgentEvent): Promise<void> {
    try {
      await this.processEvent(event, this.activeSignal());
    } catch (error) {
      throw new EventSinkFailure(error);
    }
  }

  /** Publishes one fixed-fact event; observer failures are isolated and never change the result. */
  private async publishIsolated(event: AgentEvent): Promise<void> {
    this.projectEvent(event);
    const signal = this.activeSignal();
    for (const listener of [...this.listeners]) {
      try {
        await listener(event, signal);
      } catch {
        // The result is already fixed; a late observer failure cannot revise it.
      }
    }
  }

  private enqueuePublish(task: () => Promise<void>): Promise<void> {
    const next = this.publishChain.then(task);
    this.publishChain = next.catch(() => undefined);
    return next;
  }

  private activeSignal(): AbortSignal {
    const active = this.activeExecution;
    if (active) return active.controller.signal;
    // Outside an execution there is no work to signal; a never-aborted signal
    // keeps the listener contract uniform.
    return NEVER_ABORTED_SIGNAL;
  }

  private async processEvent(event: AgentEvent, signal: AbortSignal): Promise<void> {
    this.projectEvent(event);
    for (const listener of [...this.listeners]) {
      await listener(event, signal);
    }
  }

  private projectEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.lastError = undefined;
        break;
      case 'message_start':
        if (event.message.role === 'assistant') this.streamingMessage = event.message;
        break;
      case 'message_update':
        this.streamingMessage = event.message;
        break;
      case 'message_end':
        if (event.message.role === 'assistant') this.streamingMessage = undefined;
        this.messages.push(event.message);
        break;
      case 'tool_execution_start': {
        const pending = new Set(this.pendingToolCallIds);
        pending.add(event.toolCallId);
        this.pendingToolCallIds = pending;
        break;
      }
      case 'tool_execution_end': {
        const pending = new Set(this.pendingToolCallIds);
        pending.delete(event.toolCallId);
        this.pendingToolCallIds = pending;
        break;
      }
      case 'agent_end':
        this.streamingMessage = undefined;
        this.pendingToolCallIds = new Set();
        this.lastError = event.result.status === 'failed' ? event.result.error : undefined;
        break;
      default:
        break;
    }
  }

  private assertCanStart(): void {
    if (this.activeExecution) throw new AgentOperationError('agent_busy');
  }

  private assertIdleMutation(): void {
    if (this.activeExecution) throw new AgentOperationError('invalid_state');
  }
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

function copyConfiguration(configuration: AgentConfiguration): AgentConfiguration {
  return { ...configuration, tools: [...configuration.tools] };
}

function executionSnapshot(state: AgentExecutionState): AgentExecutionState {
  return state.status === 'idle' ? { status: 'idle' } : { ...state };
}

function sameExecutionState(left: AgentExecutionState, right: AgentExecutionState): boolean {
  if (left.status === 'idle' || right.status === 'idle') return left.status === right.status;
  return left.status === right.status
    && left.executionId === right.executionId
    && left.phase === right.phase
    && left.turn === right.turn
    && left.attempt === right.attempt;
}

function resolveExecutionId(value: string | undefined): string {
  if (value === undefined) return `execution:${crypto.randomUUID()}`;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentOperationError('invalid_state', 'Agent executionId must be a non-empty string.');
  }
  return value;
}

function failedResult(
  executionId: string,
  error: AgentError,
  newMessages: readonly AgentMessage[],
): AgentExecutionResult {
  return { status: 'failed', executionId, newMessages: [...newMessages], error };
}

function listenerFailure(cause: unknown): AgentError {
  return {
    code: 'event_listener_failed',
    message: cause instanceof Error ? cause.message : 'An Agent event listener failed.',
    retryable: false,
    cause,
  };
}

function normalizeAgentFailure(error: unknown): AgentError {
  if (error instanceof EventSinkFailure) return listenerFailure(error.cause);
  if (isAgentError(error)) return error;
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'Agent execution failed.',
    retryable: false,
    cause: error,
  };
}

function isAgentError(value: unknown): value is AgentError {
  return typeof value === 'object'
    && value !== null
    && typeof (value as AgentError).code === 'string'
    && typeof (value as AgentError).message === 'string'
    && typeof (value as AgentError).retryable === 'boolean';
}

function describeState(state: AgentExecutionState): string {
  return state.status === 'idle' ? 'idle' : `${state.status}.${state.phase}`;
}

function resolvePolicy(patch: Partial<AgentPolicy> | undefined): AgentPolicy {
  const policy: AgentPolicy = { ...DEFAULT_AGENT_POLICY, ...patch };
  const positiveFields = [
    'maxModelCalls',
    'maxModelCallAttempts',
    'maxToolRounds',
    'maxToolCalls',
    'maxToolCallsPerModelCall',
    'maxConcurrentToolCalls',
    'modelCallTimeoutMs',
    'toolCallTimeoutMs',
  ] as const satisfies readonly (keyof AgentPolicy)[];
  const nonNegativeFields = [
    'modelRetryDelayMs',
    'maxContextOverflowRecoveries',
  ] as const satisfies readonly (keyof AgentPolicy)[];
  for (const field of positiveFields) {
    if (!Number.isInteger(policy[field]) || policy[field] <= 0) {
      throw new TypeError(`Invalid AgentPolicy.${field}: expected a positive integer.`);
    }
  }
  for (const field of nonNegativeFields) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0) {
      throw new TypeError(`Invalid AgentPolicy.${field}: expected a non-negative integer.`);
    }
  }
  return policy;
}

function operationErrorMessage(code: AgentOperationErrorCode): string {
  return code === 'agent_busy'
    ? 'Agent is already executing.'
    : 'Agent operation is invalid in the current state.';
}
