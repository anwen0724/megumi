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
  RecordCompletedModelCallUsageRequest,
} from '@megumi/context';
import type {
  SaveAssistantReplyRequest,
  SaveModelResponseRequest,
  SaveToolResultMessageRequest,
  SaveUserMessageRequest,
} from '@megumi/session';
import type { ToolExecutor } from '@megumi/tools';
import type { RuntimeEvent } from '@megumi/events';
import type { ObservabilityService } from '@megumi/observability';
import type {
  CreateEngineOptions,
  Engine,
  EnginePolicy,
  StartRunRequest,
} from '@megumi/engine';
import { AssistantMessageEventStream } from '../../../packages/ai/src/utils/event-stream';
import { createEngine } from '../../../packages/engine/src/engine';
import {
  allowDecision,
  approvalSubjectFor,
  registeredTool,
  succeeded,
  toolExecutor,
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
  toolExecutionTimeoutMs: 1_000,
  cancellationTimeoutMs: 50,
  maxModelCallAttempts: 1,
  modelRetryDelayMs: 0,
  maxToolExecutionsPerCall: 1,
  toolRetryDelayMs: 0,
  terminalRunRetentionMs: 60_000,
};

export const startRequest: StartRunRequest = {
  requestId: 'request:1',
  workspaceId: 'workspace:1',
  sessionId: 'session:1',
  input: { text: 'hello', attachments: [] },
  model,
  permissionMode: 'ask',
};

export interface EngineFixture {
  readonly engine: Engine;
  readonly options: CreateEngineOptions;
  readonly writes: string[];
  readonly contextRuns: unknown[];
  readonly contextUsageRecords: RecordCompletedModelCallUsageRequest[];
  readonly published: RuntimeEvent[];
  readonly assistantReplies: SaveAssistantReplyRequest[];
  readonly toolResults: SaveToolResultMessageRequest[];
}

export function createEngineFixture(input: {
  readonly streams?: AssistantMessageEventStream[];
  readonly tools?: ReturnType<typeof registeredTool>[];
  readonly permissions?: Pick<
    Permissions,
    'evaluateToolCall' | 'applyApprovalDecision'
  >;
  readonly executeTool?: ToolExecutor['execute'];
  readonly policy?: Partial<EnginePolicy>;
  readonly contextBuild?: CreateEngineOptions['context']['build'];
  readonly eventPublisher?: CreateEngineOptions['eventPublisher'];
  readonly observability?: ObservabilityService;
} = {}): EngineFixture {
  const writes: string[] = [];
  const contextRuns: unknown[] = [];
  const contextUsageRecords: RecordCompletedModelCallUsageRequest[] = [];
  const published: RuntimeEvent[] = [];
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
    return {
      status: 'saved' as const,
      message: {
        message: {
          message_id: request.message_id,
          session_id: request.session_id,
          ...(request.run_id ? { run_id: request.run_id } : {}),
          message_kind: 'user_message' as const,
          content: request.content,
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
      };
    },
    applyApprovalDecision: async () => ({
      status: 'applied',
      effect: { type: 'none' },
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
        contextRuns.push(structuredClone(request.currentRun));
        return {
          status: 'ready',
          prepared: {
            preparationId: `preparation:${contextRuns.length}`,
            context,
            usage: {
              usedTokens: 0,
              contextWindowTokens: 4_096,
              remainingTokens: 4_096,
              usedRatio: 0,
              compactionThresholdRatio: 0.8,
            },
            sourceRefs: [],
          },
        };
      }),
      recordCompletedModelCall: (request) => {
        contextUsageRecords.push(structuredClone(request));
        return {
          status: 'recorded',
          snapshot: {
            sessionId: request.sessionId,
            runId: request.runId,
            providerId: request.model.provider,
            modelId: request.model.id,
            usage: request.preCallUsage,
            accuracy: 'estimated',
            calculatedAt: '2026-07-31T00:00:00.000Z',
          },
        };
      },
    },
    session: {
      saveUserMessage,
      saveModelResponse,
      saveToolResultMessage,
      saveAssistantReply,
    },
    toolCatalog: {
      list: () => ({ tools: input.tools ?? [] }),
    },
    toolExecutionForRun: () => toolExecutor(input.tools ?? [], input.executeTool),
    permissions: input.permissions ?? defaultPermissions,
    eventPublisher: input.eventPublisher ?? {
      publish: (event) => {
        published.push(event);
      },
    },
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
    contextUsageRecords,
    published,
    assistantReplies,
    toolResults,
  };
}

export function assistantStream(
  text: string,
  toolCall?: { readonly id: string; readonly name: string; readonly arguments: unknown },
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const content: AssistantMessage['content'] = [{ type: 'text', text }];
  if (toolCall) {
    content.push({
      type: 'toolCall',
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments as Record<string, unknown>,
    });
  }
  const message: AssistantMessage = {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: toolCall ? 'toolUse' : 'stop',
    timestamp: 1,
  };
  stream.push({ type: 'start', partial: { ...message, content: [] } });
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: text,
    partial: { ...message, content: [{ type: 'text', text }] },
  });
  if (toolCall) {
    stream.push({
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: content[1] as Extract<AssistantMessage['content'][number], { type: 'toolCall' }>,
      partial: message,
    });
  }
  stream.push({ type: 'done', reason: toolCall ? 'toolUse' : 'stop', message });
  return stream;
}

export function neverEndingStream(): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  };
  stream.push({ type: 'start', partial });
  return stream;
}

export function partialNeverEndingStream(text: string): AssistantMessageEventStream {
  const stream = neverEndingStream();
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  };
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: text,
    partial,
  });
  return stream;
}

export function retryableFailedStream(text: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const failure = createModelFailure({
    code: 'rate_limited',
    retryable: true,
  });
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: 'error',
    timestamp: 1,
    failure,
    errorMessage: failure.message,
  };
  stream.push({ type: 'start', partial: { ...partial, content: [] } });
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: text,
    partial,
  });
  stream.push({
    type: 'error',
    reason: 'error',
    failure,
    error: partial,
  });
  return stream;
}

export async function collectEvents(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const collected: RuntimeEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
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
