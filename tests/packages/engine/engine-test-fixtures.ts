/*
 * Supplies typed in-memory collaborators for public Engine behavior tests.
 */
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Models,
} from '@megumi/ai';
import { createModelFailure } from '@megumi/ai';
import type {
  EvaluateToolCallRequest,
  PermissionDecision,
  Permissions,
} from '@megumi/permissions';
import type {
  BuildContextResult,
  CompactContextResult,
  ContextUsageEstimate,
} from '@megumi/context';
import type {
  SaveAssistantReplyRequest,
  SaveModelResponseRequest,
  SaveToolResultMessageRequest,
  SaveUserMessageRequest,
} from '@megumi/session';
import { createEventBus, type AnyEvent } from '@megumi/events';
import type { ObservabilityService } from '@megumi/observability';
import type {
  CreateEngineOptions,
  Engine,
  EnginePolicy,
  Run,
  StartRunRequest,
} from '@megumi/engine';
import { AssistantMessageEventStream } from '../../../packages/ai/src/utils/event-stream';
import { createEngine } from '../../../packages/engine/src/engine';
import {
  allowDecision,
  approvalSubjectFor,
  registeredTool,
  restrictedExecutionAccess,
  succeeded,
  unrestrictedExecutionAccess,
  toolsForRun,
  type TestToolExecute,
} from './tool-call-test-fixtures';

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const model: Model<Api> = {
  id: 'model:test',
  name: 'Test Model',
  api: 'test-api',
  provider: 'provider:test',
  baseUrl: 'https://provider.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4_096,
  maxTokens: 512,
};

export const enginePolicy: EnginePolicy = {
  maxModelCallsPerRun: 4,
  maxToolRoundsPerRun: 3,
  maxToolCallsPerModelCall: 4,
  maxToolCallsPerRun: 8,
  maxConcurrentToolExecutions: 2,
  modelCallTimeoutMs: 1_000,
  modelCallTerminationTimeoutMs: 100,
  toolExecutionTimeoutMs: 1_000,
  cancellationTimeoutMs: 50,
  maxModelCallAttempts: 1,
  modelRetryDelayMs: 0,
  maxToolExecutionsPerCall: 1,
  terminalRunRetentionMs: 60_000,
};

export const startRequest: StartRunRequest = {
  requestId: 'request:1',
  workspaceId: 'workspace:1',
  sessionId: 'session:1',
  input: {
    displayContent: [{ type: 'text', text: 'hello' }],
    modelContent: [{ type: 'text', text: 'hello' }],
    attachments: [],
  },
  model,
  permissionMode: 'ask',
};

export interface EngineFixture {
  readonly engine: Engine;
  readonly options: CreateEngineOptions;
  readonly writes: string[];
  readonly contextRuns: unknown[];
  readonly published: AnyEvent[];
  readonly assistantReplies: SaveAssistantReplyRequest[];
  readonly toolResults: SaveToolResultMessageRequest[];
  readonly skillViewRequests: Array<{ workspaceId?: string; signal?: AbortSignal }>;
}

export function createEngineFixture(input: {
  readonly streams?: AssistantMessageEventStream[];
  readonly tools?: ReturnType<typeof registeredTool>[];
  readonly permissions?: Pick<
    Permissions,
    'evaluateToolCall' | 'applyApprovalDecision'
  >;
  readonly executeTool?: TestToolExecute;
  readonly policy?: Partial<EnginePolicy>;
  readonly contextBuild?: CreateEngineOptions['context']['build'];
  readonly contextCompact?: CreateEngineOptions['context']['compact'];
  readonly failUserMessageSave?: boolean;
  readonly skillView?: Pick<CreateEngineOptions['skills'], 'createView'>;
  readonly observability?: ObservabilityService;
} = {}): EngineFixture {
  const writes: string[] = [];
  const contextRuns: unknown[] = [];
  const skillViewRequests: Array<{ workspaceId?: string; signal?: AbortSignal }> = [];
  const published: AnyEvent[] = [];
  const eventsBus = createEventBus();
  eventsBus.subscribe({}, (event) => { published.push(event); });
  const assistantReplies: SaveAssistantReplyRequest[] = [];
  const toolResults: SaveToolResultMessageRequest[] = [];
  const streams = [...(input.streams ?? [assistantStream('done')])];
  let runNumber = 0;
  let modelCallNumber = 0;
  let executionNumber = 0;
  let approvalNumber = 0;
  let messageNumber = 0;
  let eventNumber = 0;
  let entryNumber = 0;

  const saveUserMessage = async (request: SaveUserMessageRequest) => {
    writes.push('user');
    if (input.failUserMessageSave) {
      return { status: 'failed' as const, failure: { code: 'session_error', message: 'User message save failed.' } };
    }
    return {
      status: 'saved' as const,
      message: {
        message: {
          message_id: request.message_id,
          session_id: request.session_id,
          ...(request.run_id ? { run_id: request.run_id } : {}),
          message_kind: 'user_message' as const,
          display_content: request.display_content,
          model_content: request.model_content,
          ...(request.skill_selection ? { skill_selection: request.skill_selection } : {}),
          created_at: request.created_at,
        },
        attachments: [],
      },
      entry: {
        entry_id: `entry:${++entryNumber}`,
        session_id: request.session_id,
        ...(request.parent_entry_id ? { parent_entry_id: request.parent_entry_id } : {}),
        entry_type: 'message' as const,
        message_id: request.message_id,
        created_at: request.created_at,
      },
    };
  };

  const saveModelResponse = (request: SaveModelResponseRequest) => {
    writes.push('model');
    return savedMessage(request, 'model_response', ++entryNumber);
  };
  const saveToolResultMessage = (request: SaveToolResultMessageRequest) => {
    writes.push('tool');
    toolResults.push(structuredClone(request));
    return savedMessage(request, 'tool_result', ++entryNumber);
  };
  const saveAssistantReply = (request: SaveAssistantReplyRequest) => {
    writes.push(`assistant:${request.status}`);
    assistantReplies.push(structuredClone(request));
    return savedMessage(request, 'assistant_reply', ++entryNumber);
  };

  const defaultPermissions: Pick<
    Permissions,
    'evaluateToolCall' | 'applyApprovalDecision'
  > = {
    evaluateToolCall: async (request) => {
      const decision = allowDecision(request);
      return {
        status: 'ok',
        operations: decision.operations,
        decision,
        approvalSubject: approvalSubjectFor(request, decision),
        executionAccess: restrictedExecutionAccess,
      };
    },
    applyApprovalDecision: async () => ({
      status: 'applied',
      effect: { type: 'none' },
      executionAccess: unrestrictedExecutionAccess,
    }),
  };

  const context: Context = { systemPrompt: 'test', messages: [] };
  const options: CreateEngineOptions = {
    models: {
      streamSimple: (() => {
        const stream = streams.shift();
        if (!stream) throw new Error('No model stream configured.');
        return stream;
      }) as Models['streamSimple'],
    } as Models,
    context: {
      build: input.contextBuild ?? (async (request): Promise<BuildContextResult> => {
        contextRuns.push(structuredClone(request.modelCallContext));
        return { status: 'ready', prompt: context };
      }),
      compact: input.contextCompact ?? (async () => ({
        status: 'nothing_to_compact' as const,
        reason: 'no_historical_messages',
      })),
    },
    scopeResolver: {
      resolve({ workspaceId }) {
        return {
          status: 'resolved' as const,
          workspaceRoot: `C:/workspace/${workspaceId}`,
          executionEnvironment: {
            workingDirectory: `C:/workspace/${workspaceId}`,
            operatingSystem: 'Windows',
            shell: 'PowerShell',
          },
        };
      },
    },
    instructions: {
      getEffectiveInstructions: async () => ({
        status: 'ok' as const,
        instructions: { sources: [] },
      }),
    },
    session: {
      saveUserMessage,
      saveModelResponse,
      saveToolResultMessage,
      saveAssistantReply,
    },
    tools: toolsForRun(input.tools ?? [], input.executeTool),
    skills: input.skillView ?? {
      async createView(request) {
        skillViewRequests.push({ workspaceId: request.workspaceId, signal: request.signal });
        return { status: 'ok', view: { catalog: [], diagnostics: [] } };
      },
    },
    permissions: input.permissions ?? defaultPermissions,
    events: eventsBus,
    ...(input.observability ? { observability: input.observability } : {}),
    ids: {
      createRunId: () => `run:${++runNumber}`,
      createModelCallId: () => `model-call:${++modelCallNumber}`,
      createToolExecutionId: () => `tool-execution:${++executionNumber}`,
      createRunApprovalId: () => `approval:${++approvalNumber}`,
      createSessionMessageId: () => `message:${++messageNumber}`,
      createRuntimeEventId: () => `event:${++eventNumber}`,
    },
    clock: { now: () => '2026-07-31T00:00:00.000Z' },
    policy: { ...enginePolicy, ...input.policy },
  };
  return {
    engine: createEngine(options),
    options,
    writes,
    contextRuns,
    published,
    assistantReplies,
    toolResults,
    skillViewRequests,
  };
}

export async function startedRun(
  fixture: EngineFixture,
  request: StartRunRequest = startRequest,
): Promise<{ readonly run: Run }> {
  const started = await fixture.engine.startRun(request);
  if (started.status !== 'started') {
    throw new Error(`Expected started Run, got ${started.status}.`);
  }
  return { run: started.run };
}

export async function requestedCancellation(
  fixture: EngineFixture,
  runId: string,
): Promise<{ readonly run: Run }> {
  const cancellation = await fixture.engine.cancelRun({ runId });
  if (cancellation.status !== 'cancellation_requested') {
    throw new Error(`Expected cancellation request, got ${cancellation.status}.`);
  }
  return { run: cancellation.run };
}

export async function compactedOverflowCompaction(): Promise<Extract<CompactContextResult, { status: 'compacted' }>> {
  const usageBefore: ContextUsageEstimate = {
    tokens: 100,
    usageTokens: 0,
    trailingTokens: 100,
    lastUsageIndex: null,
  };
  return {
    status: 'compacted',
    compactionId: 'compaction:overflow',
    usageBefore,
    usageAfter: { tokens: 20, usageTokens: 0, trailingTokens: 20, lastUsageIndex: null },
  };
}

function baseMessage(
  overrides: Omit<AssistantMessage, 'role' | 'api' | 'provider' | 'model' | 'timestamp'>,
): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    timestamp: 1,
    ...overrides,
  };
}

function pushAssistantStream(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
  options: {
    readonly text?: string;
    readonly toolCall?: Extract<AssistantMessage['content'][number], { type: 'toolCall' }>;
    readonly doneReason?: Extract<AssistantMessage['stopReason'], 'stop' | 'length' | 'toolUse'>;
  } = {},
): void {
  stream.push({ type: 'start', partial: { ...message, content: [] } });
  if (options.text !== undefined) {
    stream.push({
      type: 'text_delta',
      contentIndex: 0,
      delta: options.text,
      partial: { ...message, content: [{ type: 'text', text: options.text }] },
    });
  }
  if (options.toolCall) {
    stream.push({
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: options.toolCall,
      partial: message,
    });
  }
  if (options.doneReason) {
    stream.push({ type: 'done', reason: options.doneReason, message });
  }
}

export function assistantStreamWithUsage(
  text: string,
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
  },
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = baseMessage({
    content: [{ type: 'text', text }],
    usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
  });
  pushAssistantStream(stream, message, { text, doneReason: 'stop' });
  return stream;
}

/** Provider streams a thinking block first, then the answer text. */
export function assistantThinkingStream(
  thinking: string,
  text: string,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = baseMessage({
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  });
  stream.push({ type: 'start', partial: { ...message, content: [] } });
  stream.push({ type: 'thinking_start', contentIndex: 0, partial: { ...message, content: [] } });
  stream.push({ type: 'thinking_delta', contentIndex: 0, delta: thinking, partial: { ...message, content: [] } });
  stream.push({ type: 'thinking_end', contentIndex: 0, content: thinking, partial: { ...message, content: [] } });
  stream.push({ type: 'text_start', contentIndex: 0, partial: { ...message, content: [] } });
  stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message });
  stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message });
  stream.push({ type: 'done', reason: 'stop', message });
  return stream;
}

export function assistantStream(
  text: string,
  toolCall?: { readonly id: string; readonly name: string; readonly arguments: unknown },
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const toolCallBlock: Extract<AssistantMessage['content'][number], { type: 'toolCall' }> | undefined
    = toolCall
      ? {
          type: 'toolCall',
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments as Record<string, unknown>,
        }
      : undefined;
  const message = baseMessage({
    content: [
      { type: 'text', text },
      ...(toolCallBlock ? [toolCallBlock] : []),
    ],
    stopReason: toolCall ? 'toolUse' : 'stop',
  });
  pushAssistantStream(stream, message, {
    text,
    toolCall: toolCallBlock,
    doneReason: toolCall ? 'toolUse' : 'stop',
  });
  return stream;
}

/** Provider returns a completed response whose error message matches the overflow signature. */
export function errorOverflowStream(): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const failure = createModelFailure({
    code: 'invalid_request',
    retryable: false,
  });
  const message = baseMessage({
    content: [{ type: 'text', text: 'prompt is too long: 213462 tokens > 200000 maximum' }],
    stopReason: 'error',
    failure,
    errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
  });
  pushAssistantStream(stream, message);
  // The provider overflow text arrives as the raw thrown cause; the stream
  // normalization preserves it because it matches the Overflow signature.
  stream.push({
    type: 'error',
    reason: 'error',
    failure,
    error: message,
    cause: new Error('prompt is too long: 213462 tokens > 200000 maximum'),
  });
  return stream;
}

/** Provider silently truncates the oversized input: length-stop with zero output filling the window. */
export function lengthOverflowStream(): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = baseMessage({
    content: [],
    usage: {
      input: 4056,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 4056,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'length',
  });
  pushAssistantStream(stream, message, { doneReason: 'length' });
  return stream;
}

export function neverEndingStream(): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  pushAssistantStream(stream, baseMessage({ content: [], stopReason: 'stop' }));
  return stream;
}

export function partialNeverEndingStream(text: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  pushAssistantStream(stream, baseMessage({
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  }), { text });
  return stream;
}

export function retryableFailedStream(text: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const failure = createModelFailure({
    code: 'rate_limited',
    retryable: true,
  });
  const message = baseMessage({
    content: [{ type: 'text', text }],
    stopReason: 'error',
    failure,
    errorMessage: failure.message,
  });
  pushAssistantStream(stream, message, { text });
  stream.push({
    type: 'error',
    reason: 'error',
    failure,
    error: message,
  });
  return stream;
}

/** All events published for one run, in bus order. */
export function collectEvents(fixture: EngineFixture, runId: string): AnyEvent[] {
  return fixture.published.filter((event) => event.runId === runId);
}

/** Waits until the run settles (run.ended published) so behavior assertions are safe. */
export async function settleRun(fixture: EngineFixture, timeoutMs = 2_000): Promise<void> {
  await new Promise<void>((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = (): void => {
      if (fixture.published.some((event) => event.type === 'run.ended')) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error('Run did not settle within the timeout.');
      }
      setTimeout(check, 10);
    };
    check();
  });
}

export function approvalDecisionFor(
  request: EvaluateToolCallRequest,
): Extract<PermissionDecision, { type: 'requires_approval' }> {
  const allowed = allowDecision(request);
  const subject = approvalSubjectFor(request, allowed);
  return {
    ...allowed,
    type: 'requires_approval',
    reason: 'Approval required.',
    options: [{
      optionId: `once:${request.toolCallId}`,
      scope: 'once',
      display: { label: 'Once', description: 'Allow once.' },
      effect: { type: 'current_tool_call' },
    }],
    defaultOptionId: `once:${request.toolCallId}`,
    subjectFingerprint: subject.fingerprint,
  };
}

function savedMessage(
  request: SaveModelResponseRequest | SaveToolResultMessageRequest | SaveAssistantReplyRequest,
  kind: 'model_response' | 'tool_result' | 'assistant_reply',
  entryNumber: number,
) {
  const shared = {
    message_id: request.message_id,
    session_id: request.session_id,
    run_id: request.run_id,
    created_at: request.completed_at,
    completed_at: request.completed_at,
  };
  const message = kind === 'model_response'
    ? {
        ...shared,
        message_kind: kind,
        content: (request as SaveModelResponseRequest).content,
        outcome_status: (request as SaveModelResponseRequest).outcome_status,
        ...((request as SaveModelResponseRequest).stop_reason
          ? { stop_reason: (request as SaveModelResponseRequest).stop_reason }
          : {}),
      }
    : kind === 'tool_result'
      ? {
          ...shared,
          message_kind: kind,
          tool_call_id: (request as SaveToolResultMessageRequest).tool_call_id,
          tool_name: (request as SaveToolResultMessageRequest).tool_name,
          status: (request as SaveToolResultMessageRequest).status,
          content: (request as SaveToolResultMessageRequest).content,
          ...((request as SaveToolResultMessageRequest).error
            ? { error: (request as SaveToolResultMessageRequest).error }
            : {}),
        }
      : {
          ...shared,
          message_kind: kind,
          status: (request as SaveAssistantReplyRequest).status,
          content: (request as SaveAssistantReplyRequest).content,
          ...((request as SaveAssistantReplyRequest).reason_code
            ? { reason_code: (request as SaveAssistantReplyRequest).reason_code }
            : {}),
        };
  return {
    status: 'saved' as const,
    message,
    entry: {
      entry_id: `entry:${entryNumber}`,
      session_id: request.session_id,
      ...(request.parent_entry_id ? { parent_entry_id: request.parent_entry_id } : {}),
      entry_type: 'message' as const,
      message_id: request.message_id,
      created_at: request.completed_at,
    },
  };
}
