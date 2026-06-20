// Orchestrates Agent Run turns across context, AI stream, permission-gated tools, and session facts.
import type { AiRequestOptions, AssistantMessage, AssistantMessageEventStream, Model, ToolSet } from '../ai';
import { buildModelContextInput, type ContextMessageFact, type ContextToolResultMessageFact } from '../context';
import type { ParsedInput } from '../input';
import {
  createApprovalRecord,
  createApprovalRequest,
  createPermissionRecord,
  createPermissionSnapshot,
  type PermissionEvaluator,
  type PermissionOperation,
  type PermissionRecord,
  type PermissionRepository,
  type PolicyDecision,
  resolveApprovalRequest,
} from '../permission';
import { createMegumiError, type JsonObject, type JsonValue, type MegumiError } from '../shared';
import type { SessionMessage, SessionRunRecord, SessionStateRepository } from '../session';
import { preflightToolCall, shapeToolResultObservation, type ToolCall, type ToolRegistry, type ToolResult } from '../tools';
import type { AgentRunEvent } from './events';
import {
  parseApprovalWaitStateFromRunMetadata,
  serializeApprovalWaitStateForRunMetadata,
  serializeAssistantMessageForSession,
  serializeToolResultMessageForSession,
} from './serializers';
import { createToolCallsFromAssistantMessage } from './tool-call';
import { createToolExecutionWindows } from './tool-scheduler';
import type {
  AgentApprovalWaitState,
  AgentRun,
  AgentRunResult,
  AgentRunStartResult,
  AgentRunStatus,
  ResumeAgentRunInput,
  StartAgentRunInput,
} from './types';

export interface AgentSessionManager {
  appendMessage(input: {
    idSeed: string;
    sourceEntryIdSeed: string;
    sessionId: string;
    role: SessionMessage['role'];
    content: JsonValue;
    metadata?: JsonObject;
  }): { message: SessionMessage };
  recordRun(input: {
    idSeed: string;
    sourceEntryIdSeed: string;
    sessionId: string;
    inputSummary: string;
    status: AgentRunStatus;
    metadata?: JsonObject;
  }): { run: SessionRunRecord };
  updateRunStatus(input: {
    runId: string;
    status: AgentRunStatus;
    endedAt?: string;
    error?: JsonObject;
    metadata?: JsonObject;
  }): SessionRunRecord;
}

export interface AgentToolExecutor {
  execute(call: ToolCall, context: {
    permissionDecision?: PolicyDecision;
    approvalRequestId?: string;
    runId?: string;
    sessionId?: string;
    workspaceId?: string;
    turnIndex?: number;
  }): Promise<ToolResult>;
}

export interface AgentAiClient {
  stream(
    model: Model,
    context: Parameters<typeof buildModelContextInput>[0]['base'] extends never ? never : ReturnType<typeof buildModelContextInput>['modelContextInput'],
    options: AiRequestOptions,
    toolSet?: ToolSet,
  ): AssistantMessageEventStream;
}

export interface CreateAgentRunnerOptions {
  sessionManager: AgentSessionManager;
  sessionRepository: SessionStateRepository;
  permissionRepository: PermissionRepository;
  permissionEvaluator: PermissionEvaluator;
  toolRegistry: ToolRegistry;
  toolSet: ToolSet;
  toolExecutor: AgentToolExecutor;
  ai: AgentAiClient;
  model: Model;
  aiOptions: AiRequestOptions;
  systemInstruction: string;
  now: () => string;
  createId?: (prefix: string, value: string) => string;
  emit?: (event: AgentRunEvent) => void;
}

export function createAgentRunner(options: CreateAgentRunnerOptions) {
  const createId = options.createId ?? ((prefix, value) => `${prefix}_${value}`);
  const emit = options.emit ?? (() => undefined);

  return {
    async startRun(input: StartAgentRunInput): Promise<AgentRunStartResult> {
      if (input.parsedInput.kind === 'app_operation') {
        return { kind: 'not_agent_run', reason: 'app_operation', parsedInputId: String(input.parsedInput.id) };
      }

      const runSeed = `run-${String(input.parsedInput.id)}`;
      const runId = createId('session-run', runSeed);
      const startedAt = options.now();
      const requestId = requestIdFromParsedInput(input.parsedInput);

      options.sessionManager.appendMessage({
        idSeed: `user-${String(input.parsedInput.id)}`,
        sourceEntryIdSeed: `source-user-${String(input.parsedInput.id)}`,
        sessionId: input.sessionId,
        role: 'user',
        content: serializeParsedInputForSession(input.parsedInput, runId),
        metadata: {
          agentRunId: runId,
          parsedInputId: String(input.parsedInput.id),
          ...(requestId ? { requestId } : {}),
        },
      });

      const recorded = options.sessionManager.recordRun({
        idSeed: runSeed,
        sourceEntryIdSeed: `source-run-${String(input.parsedInput.id)}`,
        sessionId: input.sessionId,
        inputSummary: summarizeInput(input.parsedInput),
        status: 'running',
        metadata: {
          parsedInputId: String(input.parsedInput.id),
          ...(requestId ? { requestId } : {}),
        },
      });
      const run = toAgentRun(recorded.run, input.parsedInput, input.workspaceId);
      await options.permissionRepository.savePermissionSnapshot(createPermissionSnapshot({
        id: createId('permission-snapshot', run.id),
        runId: run.id,
        sessionId: input.sessionId,
        mode: input.options.permissionMode,
        modeSource: 'runtime_default',
        settingsSummary: { ruleCount: 0, sources: [] },
        createdAt: startedAt,
      }));
      emit({
        type: 'run.started',
        runId: run.id,
        occurredAt: startedAt,
        payload: {
          sessionId: input.sessionId,
          parsedInputId: String(input.parsedInput.id),
          ...(requestId ? { requestId } : {}),
        },
      });

      const result = await runLoop({
        run,
        parsedInput: input.parsedInput,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        model: input.model ?? options.model,
        runOptions: input.options,
        currentRunMessages: [],
        toolResultMessages: [],
        startTurnIndex: 0,
        initialToolCallCount: 0,
        signal: input.signal,
      });
      return { kind: 'agent_run', result };
    },

    async resumeRun(input: ResumeAgentRunInput): Promise<AgentRunResult> {
      const approval = await options.permissionRepository.getApprovalRequest(input.approvalRequestId);
      const runRecord = options.sessionRepository.getRunRecord(input.runId);
      const waiting = parseApprovalWaitStateFromRunMetadata(runRecord?.metadata);

      if (!approval || !runRecord || !waiting) {
        return failResume(input, 'AGENT_APPROVAL_WAIT_STATE_NOT_FOUND', 'Approval wait state was not found.');
      }
      if (
        approval.id !== input.approvalRequestId
        || approval.id !== waiting.approvalRequestId
        || waiting.runId !== input.runId
        || approval.toolCallId !== waiting.toolCall.id
      ) {
        return failResume(input, 'AGENT_APPROVAL_WAIT_STATE_MISMATCH', 'Approval wait state does not match this Run.');
      }

      const resolved = resolveApprovalRequest({ approval, userDecision: input.userDecision });
      await options.permissionRepository.saveApprovalRequest(resolved);
      await options.permissionRepository.saveApprovalRecord(createApprovalRecord({
        id: createId('approval-record', input.approvalRequestId),
        approval: resolved,
        userDecision: input.userDecision,
      }));

      const run = toAgentRun(runRecord, input.parsedInput, input.workspaceId);
      if (input.userDecision.kind === 'cancel') {
        const cancelledRecord = options.sessionManager.updateRunStatus({
          runId: input.runId,
          status: 'cancelled',
          endedAt: options.now(),
          metadata: { parsedInputId: String(input.parsedInput.id) },
        });
        emitStatus(input.runId, 'cancelled');
        return { run: toAgentRun(cancelledRecord, input.parsedInput, input.workspaceId), status: 'cancelled' };
      }

      const currentRunMessages = [...waiting.currentRunMessages];
      const toolResultMessages = [...waiting.toolResultMessages];

      if (input.userDecision.kind === 'deny') {
        const denyDecision: PolicyDecision = {
          ...approval.policyDecision,
          kind: 'deny',
          reason: 'user_denied_approval',
        };
        appendToolResult(run, waiting.turnIndex, toolResultMessages, {
          status: 'rejected',
          toolCallId: waiting.toolCall.id,
          toolName: waiting.toolCall.name,
          decision: denyDecision,
          text: 'User denied approval.',
        });
      } else {
        const allowDecision: PolicyDecision = {
          ...approval.policyDecision,
          kind: 'allow',
          reason: input.userDecision.kind,
        };
        if (input.userDecision.kind === 'allow_for_session') {
          await options.permissionRepository.savePermissionRecord(createPermissionRecord({
            id: createId('permission-record', approval.id),
            decision: allowDecision,
            userDecision: input.userDecision,
            operation: allowDecision.operation,
            target: allowDecision.target ?? allowDecision.command ?? allowDecision.operation,
            sessionId: input.sessionId,
            runId: input.runId,
            sourceApprovalRequestId: approval.id,
            createdAt: input.userDecision.decidedAt,
          }));
        }
        emitToolExecutionStarted(run.id, waiting.turnIndex, waiting.toolCall);
        const result = await options.toolExecutor.execute(waiting.toolCall, {
          permissionDecision: allowDecision,
          runId: input.runId,
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          turnIndex: waiting.turnIndex,
        });
        emitToolExecutionCompleted(run.id, waiting.turnIndex, waiting.toolCall, result);
        appendToolResult(run, waiting.turnIndex, toolResultMessages, result);
      }

      const runningRecord = options.sessionManager.updateRunStatus({
        runId: input.runId,
        status: 'running',
        metadata: { parsedInputId: String(input.parsedInput.id) },
      });
      emitStatus(input.runId, 'running');
      return runLoop({
        run: toAgentRun(runningRecord, input.parsedInput, input.workspaceId),
        parsedInput: input.parsedInput,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        model: options.model,
        runOptions: input.options,
        currentRunMessages,
        toolResultMessages,
        startTurnIndex: waiting.turnIndex + 1,
        initialToolCallCount: waiting.processedToolCallCount,
      });
    },
  };

  async function runLoop(input: {
    run: AgentRun;
    parsedInput: ParsedInput;
    sessionId: string;
    workspaceId?: string;
    model: Model;
    runOptions: StartAgentRunInput['options'];
    currentRunMessages: ContextMessageFact[];
    toolResultMessages: ContextToolResultMessageFact[];
    startTurnIndex: number;
    initialToolCallCount: number;
    signal?: AbortSignal;
  }): Promise<AgentRunResult> {
    const currentRunMessages = [...input.currentRunMessages];
    const toolResultMessages = [...input.toolResultMessages];
    let toolCallCount = input.initialToolCallCount;

    for (let turnIndex = input.startTurnIndex; turnIndex < input.runOptions.maxTurns; turnIndex += 1) {
      if (input.signal?.aborted) {
        const cancelled = updateRunStatus(input.run, 'cancelled');
        return { run: cancelled, status: 'cancelled' };
      }
      const requestId = requestIdFromParsedInput(input.parsedInput);
      emit({
        type: 'turn.started',
        runId: input.run.id,
        turnIndex,
        occurredAt: options.now(),
        payload: {
          userMessageId: createId('session-message', `user-${String(input.parsedInput.id)}`),
          ...(requestId ? { requestId } : {}),
          ...(typeof input.parsedInput.metadata?.clientMessageId === 'string'
            ? { clientMessageId: input.parsedInput.metadata.clientMessageId }
            : {}),
          userMessageText: input.parsedInput.text,
        },
      });

      const snapshot = buildModelContextInput({
        base: {
          runId: input.run.id,
          sessionId: input.sessionId,
          workspaceId: input.workspaceId,
          parsedInput: input.parsedInput,
          systemInstruction: options.systemInstruction,
          toolSet: options.toolSet,
        },
        delta: {
          turnIndex,
          sessionHistory: buildSessionHistory(input.sessionId, input.run.id),
          currentRunMessages,
          toolResultMessages,
        },
      });
      emit({
        type: 'context.ready',
        runId: input.run.id,
        turnIndex,
        occurredAt: options.now(),
        payload: {
          included: snapshot.trace.included.length,
          dropped: snapshot.trace.dropped.length,
        },
      });

      const aiOptions = input.signal ? { ...options.aiOptions, signal: input.signal } : options.aiOptions;
      const stream = options.ai.stream(input.model, snapshot.modelContextInput, aiOptions, snapshot.toolSet);
      for await (const event of stream) {
        emit({ type: 'ai.message.event', runId: input.run.id, turnIndex, occurredAt: options.now(), event });
      }
      const assistantMessage = await stream.result();
      emit({
        type: 'ai.message.completed',
        runId: input.run.id,
        turnIndex,
        occurredAt: options.now(),
        payload: { contentBlocks: assistantMessage.content.length },
      });

      if (input.signal?.aborted || assistantMessage.stopReason === 'cancelled') {
        const cancelled = updateRunStatus(input.run, 'cancelled');
        return { run: cancelled, status: 'cancelled' };
      }

      if (assistantMessage.error || assistantMessage.stopReason === 'error') {
        const error = assistantErrorToMegumiError(assistantMessage);
        const failed = updateRunStatus(input.run, 'failed', error);
        return { run: failed, status: 'failed', error };
      }

      options.sessionManager.appendMessage({
        idSeed: `assistant-${input.run.id}-${turnIndex}`,
        sourceEntryIdSeed: `source-assistant-${input.run.id}-${turnIndex}`,
        sessionId: input.sessionId,
        role: 'assistant',
        content: serializeAssistantMessageForSession(assistantMessage),
        metadata: { agentRunId: input.run.id, turnIndex },
      });
      currentRunMessages.push({
        id: `assistant-${input.run.id}-${turnIndex}`,
        source: 'current_run',
        message: assistantMessage,
        metadata: { turnIndex },
      });

      const toolCalls = createToolCallsFromAssistantMessage(assistantMessage);
      if (toolCalls.length === 0) {
        const completed = updateRunStatus(input.run, 'completed');
        return { run: completed, status: 'completed', finalAssistantMessage: assistantMessage };
      }

      toolCallCount += toolCalls.length;
      if (toolCallCount > input.runOptions.maxToolCalls) {
        return failRun(input.run, 'AGENT_MAX_TOOL_CALLS_EXCEEDED', 'Agent Run exceeded maxToolCalls.');
      }

      for (const call of toolCalls) {
        emit({
          type: 'tool.call.created',
          runId: input.run.id,
          turnIndex,
          occurredAt: options.now(),
          payload: { toolCallId: call.id, toolName: call.name, input: call.input },
        });
      }

      const toolOutcome = await handleToolCalls({
        run: input.run,
        turnIndex,
        calls: toolCalls,
        permissionMode: input.runOptions.permissionMode,
        currentRunMessages,
        toolResultMessages,
        processedToolCallCount: toolCallCount,
      });
      if (toolOutcome.kind === 'waiting') {
        return { run: toolOutcome.run, status: 'waiting_for_approval', waiting: toolOutcome.waiting };
      }
    }

    return failRun(input.run, 'AGENT_MAX_TURNS_EXCEEDED', 'Agent Run exceeded maxTurns.');
  }

  async function handleToolCalls(input: {
    run: AgentRun;
    turnIndex: number;
    calls: ToolCall[];
    permissionMode: StartAgentRunInput['options']['permissionMode'];
    currentRunMessages: ContextMessageFact[];
    toolResultMessages: ContextToolResultMessageFact[];
    processedToolCallCount: number;
  }): Promise<{ kind: 'continued' } | { kind: 'waiting'; run: AgentRun; waiting: AgentApprovalWaitState }> {
    const allowed: Array<{
      call: ToolCall;
      decision: PolicyDecision;
      executionMode: 'serial' | 'parallel';
      mutation: 'read_only' | 'mutation' | 'process' | 'network' | 'external_state';
    }> = [];

    for (const call of input.calls) {
      const preflight = preflightToolCall(call, options.toolRegistry);
      if (preflight.status !== 'ready') {
        appendToolResult(input.run, input.turnIndex, input.toolResultMessages, {
          status: 'error',
          toolCallId: call.id,
          toolName: call.name,
          error: { code: 'TOOL_PREFLIGHT_FAILED', message: preflight.message, retryable: false },
        });
        continue;
      }

      const reusable = await options.permissionRepository.findReusablePermissionRecord({
        operation: preflight.permissionInput.operation,
        target: permissionTarget(preflight.permissionInput),
        sessionId: input.run.sessionId,
        now: options.now(),
      });
      const decision = reusable
        ? createReusableAllowDecision({
            id: createId('permission-decision', `${call.id}-${reusable.id}`),
            permissionInput: preflight.permissionInput,
            mode: input.permissionMode,
            record: reusable,
            createdAt: options.now(),
          })
        : options.permissionEvaluator.evaluate({
            ...preflight.permissionInput,
            mode: input.permissionMode,
          });
      await options.permissionRepository.savePolicyDecision(decision.id, decision);

      if (decision.kind === 'deny') {
        appendToolResult(input.run, input.turnIndex, input.toolResultMessages, {
          status: 'rejected',
          toolCallId: call.id,
          toolName: call.name,
          decision,
          text: decision.reason,
        });
        continue;
      }

      if (decision.kind === 'ask') {
        const approval = createApprovalRequest({
          id: createId('approval', call.id),
          runId: input.run.id,
          sessionId: input.run.sessionId,
          toolCallId: call.id,
          decision,
          createdAt: options.now(),
        });
        await options.permissionRepository.saveApprovalRequest(approval);
        await options.toolExecutor.execute(call, {
          permissionDecision: decision,
          approvalRequestId: approval.id,
          runId: input.run.id,
          sessionId: input.run.sessionId,
          workspaceId: input.run.workspaceId,
          turnIndex: input.turnIndex,
        });
        const waiting: AgentApprovalWaitState = {
          approvalRequestId: approval.id,
          runId: input.run.id,
          turnIndex: input.turnIndex,
          processedToolCallCount: input.processedToolCallCount,
          toolCall: call,
          currentRunMessages: input.currentRunMessages,
          toolResultMessages: input.toolResultMessages,
        };
        const waitingRecord = options.sessionManager.updateRunStatus({
          runId: input.run.id,
          status: 'waiting_for_approval',
          metadata: serializeApprovalWaitStateForRunMetadata(waiting),
        });
        const waitingRun = toAgentRun(waitingRecord, { ...userInputFromRun(input.run) }, input.run.workspaceId);
        emit({
          type: 'approval.requested',
          runId: input.run.id,
          turnIndex: input.turnIndex,
          occurredAt: options.now(),
          payload: { approvalRequestId: approval.id, toolCallId: call.id },
        });
        emitStatus(input.run.id, 'waiting_for_approval');
        return { kind: 'waiting', run: waitingRun, waiting };
      }

      allowed.push({
        call: { ...call, input: preflight.executionInput },
        decision,
        executionMode: preflight.executionConstraint.executionMode,
        mutation: preflight.executionConstraint.mutation,
      });
    }

    const windows = createToolExecutionWindows(allowed.map((item) => ({
      callId: item.call.id,
      executionMode: item.executionMode,
      mutation: item.mutation,
    })));
    const allowedById = new Map(allowed.map((item) => [item.call.id, item]));

    for (const window of windows) {
      if (window.mode === 'parallel') {
        for (const callId of window.callIds) {
          const item = allowedById.get(callId);
          if (item) {
            emitToolExecutionStarted(input.run.id, input.turnIndex, item.call);
          }
        }
        const results = await Promise.all(window.callIds.map(async (callId) => {
          const item = allowedById.get(callId);
          if (!item) {
            return undefined;
          }
          const result = await options.toolExecutor.execute(item.call, {
            permissionDecision: item.decision,
            runId: input.run.id,
            sessionId: input.run.sessionId,
            workspaceId: input.run.workspaceId,
            turnIndex: input.turnIndex,
          });
          return { item, result };
        }));
        for (const outcome of results) {
          if (outcome) {
            emitToolExecutionCompleted(input.run.id, input.turnIndex, outcome.item.call, outcome.result);
            appendToolResult(input.run, input.turnIndex, input.toolResultMessages, outcome.result);
          }
        }
        continue;
      }

      const item = allowedById.get(window.callIds[0]);
      if (!item) {
        continue;
      }
      emitToolExecutionStarted(input.run.id, input.turnIndex, item.call);
      const result = await options.toolExecutor.execute(item.call, {
        permissionDecision: item.decision,
        runId: input.run.id,
        sessionId: input.run.sessionId,
        workspaceId: input.run.workspaceId,
        turnIndex: input.turnIndex,
      });
      emitToolExecutionCompleted(input.run.id, input.turnIndex, item.call, result);
      appendToolResult(input.run, input.turnIndex, input.toolResultMessages, result);
    }

    return { kind: 'continued' };
  }

  function appendToolResult(
    run: AgentRun,
    turnIndex: number,
    toolResultMessages: ContextToolResultMessageFact[],
    result: ToolResult,
  ): void {
    const observation = shapeToolResultObservation(result);
    const fact: ContextToolResultMessageFact = {
      id: createId('tool-result', `${result.toolCallId}-${turnIndex}`),
      toolCallId: observation.toolCallId,
      toolName: observation.toolName,
      status: observation.status,
      content: observation.content,
      error: observation.error,
      metadata: { ...(observation.metadata ?? {}), turnIndex },
      redaction: observation.redaction,
      truncation: observation.truncation,
      createdAt: options.now(),
    };
    toolResultMessages.push(fact);
    options.sessionManager.appendMessage({
      idSeed: `tool-result-${result.toolCallId}-${turnIndex}`,
      sourceEntryIdSeed: `source-tool-result-${result.toolCallId}-${turnIndex}`,
      sessionId: run.sessionId,
      role: 'tool_result',
      content: serializeToolResultMessageForSession(fact),
      metadata: { agentRunId: run.id, turnIndex, toolCallId: result.toolCallId },
    });
    emit({
      type: 'tool.result.created',
      runId: run.id,
      turnIndex,
      occurredAt: options.now(),
      payload: { toolCallId: result.toolCallId, toolName: result.toolName, status: result.status },
    });
  }

  function buildSessionHistory(sessionId: string, runId: string): ContextMessageFact[] {
    return options.sessionRepository.getActivePath(sessionId).flatMap((entry): ContextMessageFact[] => {
      if (entry.kind === 'message' && entry.ref.type === 'message') {
        const message = options.sessionRepository.getMessage(entry.ref.messageId);
        if (!message || message.metadata?.agentRunId === runId) {
          return [];
        }
        const contextMessage = sessionMessageToContextMessage(message);
        return contextMessage
          ? [{
              id: message.id,
              source: 'session',
              message: contextMessage,
              metadata: message.metadata,
            }]
          : [];
      }

      if (entry.kind === 'run' && entry.ref.type === 'run') {
        const run = options.sessionRepository.getRunRecord(entry.ref.runId);
        if (!run || run.id === runId || (run.status !== 'failed' && run.status !== 'cancelled')) {
          return [];
        }
        return [{
          id: `runtime-fact-${run.id}`,
          source: 'session',
          message: {
            role: 'user',
            content: runtimeFactTextForRun(run),
          },
          metadata: { agentRunId: run.id, status: run.status },
        }];
      }

      return [];
    });
  }

  function sessionMessageToContextMessage(message: SessionMessage): ContextMessageFact['message'] | undefined {
    if (message.role === 'assistant' && isJsonObject(message.content) && Array.isArray(message.content.content)) {
      if (message.content.error || message.content.stopReason === 'error') {
        return undefined;
      }
      const content = message.content.content
        .map(assistantContentBlockFromJson)
        .filter((block): block is AssistantMessage['content'][number] => Boolean(block));
      if (content.length === 0) {
        return undefined;
      }
      return {
        role: 'assistant',
        content,
      };
    }
    if (message.role === 'assistant' && typeof message.content === 'string' && message.content.trim().length > 0) {
      return {
        role: 'assistant',
        content: [{ type: 'text', text: message.content.trim() }],
      };
    }
    if (message.role !== 'user') {
      return undefined;
    }
    return {
      role: 'user',
      content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    };
  }

  function runtimeFactTextForRun(run: SessionRunRecord): string {
    const suffix = run.error && typeof run.error.message === 'string'
      ? ` Error: ${run.error.message}`
      : '';
    if (run.status === 'cancelled') {
      return `Previous run was cancelled before a final answer.${suffix}`;
    }
    return `Previous run failed before a final answer.${suffix}`;
  }

  function assistantContentBlockFromJson(value: unknown): AssistantMessage['content'][number] | undefined {
    if (!isJsonObject(value)) {
      return undefined;
    }
    if (value.type === 'text' && typeof value.text === 'string' && value.text.trim().length > 0) {
      return { type: 'text', text: value.text };
    }
    if (value.type === 'thinking' && typeof value.thinking === 'string' && value.thinking.trim().length > 0) {
      return { type: 'thinking', thinking: value.thinking };
    }
    return undefined;
  }

  function updateRunStatus(run: AgentRun, status: AgentRunStatus, error?: MegumiError): AgentRun {
    const record = options.sessionManager.updateRunStatus({
      runId: run.id,
      status,
      endedAt: status === 'completed' || status === 'failed' || status === 'cancelled' ? options.now() : undefined,
      error: error ? errorToJson(error) : undefined,
    });
    emitStatus(run.id, status);
    return toAgentRun(record, userInputFromRun(run), run.workspaceId);
  }

  function failRun(run: AgentRun, code: string, message: string): AgentRunResult {
    const error = createMegumiError({ code, message, source: 'agent', retryable: false });
    const failed = updateRunStatus(run, 'failed', error);
    return { run: failed, status: 'failed', error };
  }

  function failResume(input: ResumeAgentRunInput, code: string, message: string): AgentRunResult {
    const error = createMegumiError({ code, message, source: 'agent', retryable: false });
    const existingRun = options.sessionRepository.getRunRecord(input.runId);
    if (existingRun) {
      const failed = options.sessionManager.updateRunStatus({
        runId: input.runId,
        status: 'failed',
        endedAt: options.now(),
        error: errorToJson(error),
        metadata: existingRun.metadata,
      });
      emitStatus(input.runId, 'failed');
      return { run: toAgentRun(failed, input.parsedInput, input.workspaceId), status: 'failed', error };
    }

    return {
      run: {
        id: input.runId,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        parsedInputId: String(input.parsedInput.id),
        status: 'failed',
        startedAt: options.now(),
        endedAt: options.now(),
      },
      status: 'failed',
      error,
    };
  }

  function emitStatus(runId: string, status: AgentRunStatus): void {
    emit({
      type: 'run.status.changed',
      runId,
      occurredAt: options.now(),
      status,
      payload: {},
    });
  }

  function emitToolExecutionStarted(runId: string, turnIndex: number, call: ToolCall): void {
    emit({
      type: 'tool.execution.started',
      runId,
      turnIndex,
      occurredAt: options.now(),
      payload: { toolCallId: call.id, toolName: call.name, input: call.input },
    });
  }

  function emitToolExecutionCompleted(runId: string, turnIndex: number, call: ToolCall, result: ToolResult): void {
    emit({
      type: 'tool.execution.completed',
      runId,
      turnIndex,
      occurredAt: options.now(),
      payload: { toolCallId: call.id, toolName: call.name, input: call.input, status: result.status },
    });
  }
}

function permissionTarget(input: { operation: PermissionOperation; target?: string; command?: string }): string {
  return input.target ?? input.command ?? input.operation;
}

function createReusableAllowDecision(input: {
  id: string;
  permissionInput: { operation: PermissionOperation; actionName?: string; target?: string; command?: string; primaryArgument?: string };
  mode: PolicyDecision['mode'];
  record: PermissionRecord;
  createdAt: string;
}): PolicyDecision {
  return {
    id: input.id,
    kind: 'allow',
    reason: `Allowed by reusable session permission ${input.record.id}.`,
    mode: input.mode,
    operation: input.permissionInput.operation,
    ...(input.permissionInput.actionName ? { actionName: input.permissionInput.actionName } : {}),
    ...(input.permissionInput.target ? { target: input.permissionInput.target } : {}),
    ...(input.permissionInput.command ? { command: input.permissionInput.command } : {}),
    risk: input.record.decision.risk,
    ...(input.record.decision.matchedRules ? { matchedRules: input.record.decision.matchedRules } : {}),
    ...(input.record.decision.classifierLabel ? { classifierLabel: input.record.decision.classifierLabel } : {}),
    createdAt: input.createdAt,
    metadata: {
      reusedPermissionRecordId: input.record.id,
      sourcePolicyDecisionId: input.record.decision.id,
      ...(input.record.sourceApprovalRequestId ? { sourceApprovalRequestId: input.record.sourceApprovalRequestId } : {}),
    },
  };
}

function serializeParsedInputForSession(parsedInput: ParsedInput, runId: string): JsonObject {
  return {
    parsedInputId: String(parsedInput.id),
    runId,
    kind: parsedInput.kind,
    text: parsedInput.text,
    facts: parsedInput.facts as unknown as JsonValue,
    attachments: parsedInput.attachments as unknown as JsonValue,
    references: parsedInput.references as unknown as JsonValue,
  };
}

function requestIdFromParsedInput(parsedInput: ParsedInput): string | undefined {
  const fromMetadata = typeof parsedInput.metadata?.requestId === 'string' ? parsedInput.metadata.requestId : undefined;
  const fromSource = typeof parsedInput.source.metadata?.requestId === 'string' ? parsedInput.source.metadata.requestId : undefined;
  return fromMetadata ?? fromSource;
}

function summarizeInput(parsedInput: ParsedInput): string {
  const trimmed = parsedInput.text.trim();
  return trimmed.length > 0 ? trimmed : parsedInput.kind;
}

function toAgentRun(record: SessionRunRecord, parsedInput: ParsedInput, workspaceId?: string): AgentRun {
  return {
    id: record.id,
    sessionId: record.sessionId,
    workspaceId,
    parsedInputId: String(parsedInput.id),
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    metadata: record.metadata,
  };
}

function userInputFromRun(run: AgentRun): ParsedInput {
  return {
    id: run.parsedInputId,
    rawInputId: run.parsedInputId,
    source: { kind: 'system' },
    rawKind: 'system',
    kind: 'user_input',
    text: run.parsedInputId,
    attachments: [],
    references: [],
    facts: [],
    createdAt: run.startedAt,
  };
}

function errorToJson(error: MegumiError): JsonObject {
  return {
    code: error.code,
    message: error.message,
    severity: error.severity,
    source: error.source,
    retryable: error.retryable,
    ...(error.debugId ? { debugId: error.debugId } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assistantErrorToMegumiError(message: AssistantMessage): MegumiError {
  const error = message.error;
  if (error && typeof error === 'object') {
    return createMegumiError({
      code: typeof error.code === 'string' ? error.code : 'AI_MESSAGE_ERROR',
      message: typeof error.message === 'string' ? error.message : 'Assistant message stream failed.',
      source: error.source === 'ai' ? 'ai' : 'agent',
      retryable: typeof error.retryable === 'boolean' ? error.retryable : false,
      details: isJsonObject(error.details) ? error.details : undefined,
    });
  }

  return createMegumiError({
    code: 'AI_MESSAGE_ERROR',
    message: 'Assistant message stream failed.',
    source: 'ai',
    retryable: false,
  });
}
