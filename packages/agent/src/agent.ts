/* Provides the stateful public Agent interface over the execution-scoped Agent Loop. */
import { runAgentLoop } from './agent-loop';
import type {
  AgentConfiguration,
  AgentConfigurationPatch,
  AgentError,
  AgentEvent,
  AgentEventListener,
  AgentExecutionResult,
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

interface ActiveExecution {
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
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
  private status: AgentState['status'] = 'idle';
  private streamingMessage: AgentState['streamingMessage'];
  private pendingToolCallIds = new Set<string>();
  private lastError: AgentError | undefined;
  private readonly stream: AgentOptions['stream'];
  private readonly contextProvider: AgentOptions['context'];
  private readonly policy: AgentPolicy;
  private readonly listeners = new Set<AgentEventListener>();
  private activeExecution: ActiveExecution | undefined;

  constructor(options: AgentOptions) {
    this.configuration = copyConfiguration(options.initialState.configuration);
    this.messages = [...(options.initialState.messages ?? [])];
    this.stream = options.stream;
    this.contextProvider = options.context;
    this.policy = resolvePolicy(options.policy);
  }

  get state(): AgentState {
    return {
      configuration: copyConfiguration(this.configuration),
      messages: [...this.messages],
      status: this.status,
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

  async prompt(input: AgentMessage | readonly AgentMessage[]): Promise<AgentExecutionResult> {
    this.assertCanStart();
    const messages = Array.isArray(input) ? [...input] : [input];
    if (messages.length === 0) {
      throw new AgentOperationError('invalid_state', 'Agent prompt requires at least one message.');
    }
    return this.execute(messages);
  }

  async continue(): Promise<AgentExecutionResult> {
    this.assertCanStart();
    const lastMessage = this.messages.at(-1);
    if (!lastMessage || (lastMessage.role !== 'user' && lastMessage.role !== 'toolResult')) {
      throw new AgentOperationError(
        'invalid_state',
        'Agent can continue only when its history ends with a user or toolResult message.',
      );
    }
    return this.execute([]);
  }

  abort(): void {
    this.activeExecution?.controller.abort();
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

  private async execute(input: readonly AgentMessage[]): Promise<AgentExecutionResult> {
    const controller = new AbortController();
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    this.activeExecution = { controller, completion, resolveCompletion };
    this.status = 'executing';
    this.streamingMessage = undefined;
    this.pendingToolCallIds = new Set();
    this.lastError = undefined;

    let result: AgentExecutionResult;
    try {
      result = await runAgentLoop({
        configuration: copyConfiguration(this.configuration),
        messages: [...this.messages],
        input: [...input],
        stream: this.stream,
        contextProvider: this.contextProvider,
        signal: controller.signal,
        policy: this.policy,
        emit: (event) => this.processEvent(event, controller.signal),
      });
      if (result.status === 'failed') this.lastError = result.error;
      return result;
    } finally {
      this.streamingMessage = undefined;
      this.pendingToolCallIds = new Set();
      this.status = 'idle';
      const active = this.activeExecution;
      this.activeExecution = undefined;
      active?.resolveCompletion();
    }
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

function copyConfiguration(configuration: AgentConfiguration): AgentConfiguration {
  return { ...configuration, tools: [...configuration.tools] };
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
