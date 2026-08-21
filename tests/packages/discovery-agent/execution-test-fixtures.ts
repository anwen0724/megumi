/*
 * Supplies typed in-memory collaborators for Discovery Agent execution tests.
 */
import type {
  Api,
  AssistantMessage,
  Model,
  Models,
} from '@megumi/ai';
import type { ContextCapabilities, Prompt } from '@megumi/context';
import { createEventBus, type AnyEvent, type EventBus } from '@megumi/events';
import type { Permissions } from '@megumi/permissions';
import type { ObservabilityService } from '@megumi/observability';
import type {
  SaveAssistantReplyRequest,
  SaveModelResponseRequest,
  SaveToolResultMessageRequest,
  SaveUserMessageRequest,
  SessionHistory,
} from '@megumi/session';
import type { Tools } from '@megumi/tools';
import { AssistantMessageEventStream } from '../../../packages/ai/src/utils/event-stream';
import {
  launchAgentExecution,
  type DiscoveryAgentPolicy,
  type ExecuteAgentDependencies,
  type LaunchedAgentExecution,
} from '../../../packages/discovery-agent/src/execution/execute-agent';
import type {
  ExecutionMetadata,
} from '../../../packages/discovery-agent/src/execution/execution-registry';
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

export const executionPolicy: DiscoveryAgentPolicy = {
  maxModelCallsPerExecution: 4,
  maxToolRoundsPerExecution: 3,
  maxToolCallsPerModelCall: 4,
  maxToolCallsPerExecution: 8,
  maxConcurrentToolExecutions: 2,
  modelCallTimeoutMs: 1_000,
  toolExecutionTimeoutMs: 1_000,
  maxModelCallAttempts: 1,
  modelRetryDelayMs: 0,
  maxContextOverflowRecoveries: 1,
  providerRequestMaxRetries: 0,
  providerRequestMaxRetryDelayMs: 0,
};

const NOW = '2026-07-31T00:00:00.000Z';

export interface ExecutionFixture {
  readonly dependencies: ExecuteAgentDependencies;
  readonly writes: string[];
  readonly contextRuns: unknown[];
  readonly published: AnyEvent[];
  readonly assistantReplies: SaveAssistantReplyRequest[];
  readonly toolResults: SaveToolResultMessageRequest[];
  readonly events: EventBus;
}

export function createExecutionFixture(input: {
  readonly streams?: AssistantMessageEventStream[];
  readonly tools?: ReturnType<typeof registeredTool>[];
  readonly permissions?: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'>;
  readonly executeTool?: TestToolExecute;
  readonly policy?: Partial<DiscoveryAgentPolicy>;
  readonly contextBuild?: ExecuteAgentDependencies['context']['build'];
  readonly contextCompact?: ExecuteAgentDependencies['context']['compact'];
  readonly failUserMessageSave?: boolean;
  readonly observability?: ObservabilityService;
} = {}): ExecutionFixture {
  const writes: string[] = [];
  const contextRuns: unknown[] = [];
  const published: AnyEvent[] = [];
  const eventsBus = createEventBus();
  eventsBus.subscribe({}, (event) => { published.push(event); });
  const assistantReplies: SaveAssistantReplyRequest[] = [];
  const toolResults: SaveToolResultMessageRequest[] = [];
  const streams = [...(input.streams ?? [assistantStream('done')])];
  let modelCallNumber = 0;
  let executionNumber = 0;
  let approvalNumber = 0;
  let messageNumber = 0;
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
          ...(request.execution_id ? { execution_id: request.execution_id } : {}),
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

  const defaultPermissions: Pick<Permissions, 'evaluateToolCall' | 'applyApprovalDecision'> = {
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

  const context: Prompt = { systemPrompt: 'test', messages: [], tools: [] };
  const dependencies: ExecuteAgentDependencies = {
    models: {
      // Adapter contract wiring: cancellation settles the fake stream with an
      // aborted terminal so the single Agent Loop always converges.
      streamSimple: ((_model, _prompt, streamOptions) => {
        const stream = streams.shift();
        if (!stream) throw new Error('No model stream configured.');
        const settleAborted = () => {
          const aborted = baseMessage({
            content: [],
            stopReason: 'aborted',
            errorMessage: 'Request was aborted',
          });
          stream.push({ type: 'error', reason: 'aborted', error: aborted });
          stream.end(aborted);
        };
        if (streamOptions?.signal) {
          if (streamOptions.signal.aborted) settleAborted();
          else streamOptions.signal.addEventListener('abort', settleAborted, { once: true });
        }
        return stream;
      }) as Models['streamSimple'],
    } as Models,
    context: {
      build: input.contextBuild ?? (async (request): Promise<import('@megumi/context').BuildContextResult> => {
        contextRuns.push(structuredClone(request.modelCallContext));
        // The built Prompt carries the resolved ModelCall Tool Definitions so
        // Overflow compaction receives the same tools without re-resolution.
        return { status: 'ready', prompt: { ...context, tools: [...request.modelCallContext.tools] } };
      }),
      compact: input.contextCompact ?? (async () => ({
        status: 'nothing_to_compact' as const,
        reason: 'no_historical_messages',
      })),
    } as ContextCapabilities,
    session: {
      saveUserMessage,
      saveModelResponse,
      saveToolResultMessage,
      saveAssistantReply,
    } as Pick<SessionHistory, 'saveUserMessage' | 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'>,
    tools: toolsForRun(input.tools ?? [], input.executeTool),
    permissions: input.permissions ?? defaultPermissions,
    events: eventsBus,
    ...(input.observability ? { observability: input.observability } : {}),
    ids: {
      createModelCallId: () => `model-call:${++modelCallNumber}`,
      createToolExecutionId: () => `tool-execution:${++executionNumber}`,
      createApprovalId: () => `approval:${++approvalNumber}`,
      createSessionMessageId: () => `message:${++messageNumber}`,
    },
    clock: { now: () => NOW },
    policy: { ...executionPolicy, ...input.policy },
  };
  return {
    dependencies,
    writes,
    contextRuns,
    published,
    assistantReplies,
    toolResults,
    events: eventsBus,
  };
}

export function executionMetadata(overrides: Partial<ExecutionMetadata> = {}): ExecutionMetadata {
  return {
    executionId: 'execution:1',
    requestId: 'request:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    userMessageId: 'message:user',
    model,
    permissionMode: 'ask',
    createdAt: NOW,
    startedAt: NOW,
    ...overrides,
  };
}

export const executionInput = {
  displayContent: [{ type: 'text', text: 'hello' }],
  modelContent: [{ type: 'text', text: 'hello' }],
  attachments: [],
} as const;

export async function launchedExecution(
  fixture: ExecutionFixture,
  overrides: {
    readonly metadata?: Partial<ExecutionMetadata>;
    readonly awaitApproval?: (request: { readonly approval: import('../../../packages/discovery-agent/src/execution/execution-registry').ApprovalRequest }) => Promise<import('../../../packages/discovery-agent/src/execution/execution-registry').ApprovalResolution>;
  } = {},
): Promise<LaunchedAgentExecution> {
  return launchAgentExecution({
    metadata: executionMetadata(overrides.metadata),
    input: executionInput,
    awaitApproval: overrides.awaitApproval ?? (async () => ({ status: 'cancelled' as const })),
  }, fixture.dependencies);
}

/** All events published for one execution, in bus order. */
export function collectEvents(fixture: ExecutionFixture, executionId: string): AnyEvent[] {
  return fixture.published.filter((event) => event.executionId === executionId);
}

function baseMessage(
  overrides: Partial<Omit<AssistantMessage, 'role' | 'api' | 'provider' | 'model' | 'timestamp'>>,
): AssistantMessage {
  const { usage: usageOverride, ...rest } = overrides;
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usageOverride ?? ZERO_USAGE,
    timestamp: 1,
    ...rest,
  } as AssistantMessage;
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
  const message = baseMessage({
    content: [{ type: 'text', text: 'prompt is too long: 213462 tokens > 200000 maximum' }],
    stopReason: 'error',
    errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
  });
  pushAssistantStream(stream, message);
  stream.push({ type: 'error', reason: 'error', error: message });
  return stream;
}

/** A stream that starts but never settles; cancellation settles it via the fixture adapter wiring. */
export function neverEndingStream(): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  pushAssistantStream(stream, baseMessage({ content: [], stopReason: 'stop' }));
  return stream;
}

export function retryableFailedStream(text: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = baseMessage({
    content: [{ type: 'text', text }],
    stopReason: 'error',
    errorMessage: 'The model provider rate limit was reached.',
  });
  pushAssistantStream(stream, message, { text });
  stream.push({ type: 'error', reason: 'error', error: message });
  return stream;
}

export function compactedOverflowCompaction(): import('@megumi/context').CompactContextResult {
  return {
    status: 'compacted',
    compactionId: 'compaction:overflow',
    usageBefore: { tokens: 100, usageTokens: 0, trailingTokens: 100, lastUsageIndex: null },
    usageAfter: { tokens: 20, usageTokens: 0, trailingTokens: 20, lastUsageIndex: null },
  };
}

export function succeededResult(toolName: string) {
  return succeeded(toolName);
}

function savedMessage(
  request: SaveModelResponseRequest | SaveToolResultMessageRequest | SaveAssistantReplyRequest,
  kind: 'model_response' | 'tool_result' | 'assistant_reply',
  entryNumber: number,
) {
  const shared = {
    message_id: request.message_id,
    session_id: request.session_id,
    execution_id: request.execution_id,
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
