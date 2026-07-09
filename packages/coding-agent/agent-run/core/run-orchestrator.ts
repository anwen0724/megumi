/*
 * Runs the model/tool loop for one Agent Run.
 * It coordinates Context, Model Call, Tool Set, Permissions, and Session services.
 */
import type { PermissionDecision, PermissionMode, PermissionService } from '../../permissions';
import type { SessionService } from '../../session';
import type { SettingsService } from '../../settings';
import type { ToolExecutionService } from '../../tools';
import type { WorkspacePathPolicyService } from '../../workspace';
import type { CompactContextResult, ContextUsageSignal, SessionContextSource } from '../../context';
import type { JsonValue } from '../../shared-json';
import type { RuntimeError } from '../../events';
import type {
  AgentRun,
  AgentRunApprovalRequest,
  AgentRunFailure,
  AgentRunToolCall,
} from '../contracts/agent-run-contracts';
import type { AgentRunTraceLogger } from '../contracts/agent-run-trace-contracts';
import type {
  ModelCallEvent,
  ModelCallConfig,
  ModelCallMessage,
  ModelCallService,
  ToolResultRuntimeFact,
} from '../contracts/model-call-contracts';
import { transitionAgentRunStatus } from './run-lifecycle';
import {
  orchestrateToolCallGroup,
  type ModelRequestedToolCall,
} from './tool-call-orchestrator';
import type { RunToolSetBuilder } from './tool-set-builder';
import type { AgentRunRepository } from '../repositories/agent-run-repository';
import type { AgentRunRuntimeEventFactory } from './agent-run-runtime-events';

export type RunOrchestratorDependencies = {
  repository: AgentRunRepository;
  session_service: Pick<SessionService, 'saveAssistantMessage'>;
  settings_service: Pick<SettingsService, 'resolvePermissionSettings'>;
  context_service: {
    getSessionContext(request: { session_id: string; workspace_id?: string; purpose?: 'agent_response' }): Promise<
      | { status: 'ok'; session_context: unknown }
      | { status: 'failed'; failure: { code: string; message: string } }
    >;
    buildPrompt(request: {
      session_context: unknown;
      purpose: 'agent_response';
      current_user_message_id?: string;
      runtime_sources?: SessionContextSource[];
    }):
      | { status: 'ok'; prompt: unknown }
      | { status: 'failed'; failure: { code: string; message: string } };
  };
  model_call_service: ModelCallService;
  tool_set_builder: RunToolSetBuilder;
  tool_execution_service: Pick<ToolExecutionService, 'executeTool'>;
  permission_service: Pick<PermissionService, 'evaluateToolExecution'>;
  workspace_path_policy_service?: Pick<WorkspacePathPolicyService, 'classifyPath'>;
  memory_service?: {
    captureCompletedRun(request: { run_id: string; session_id: string; workspace_id: string }): Promise<unknown> | unknown;
  };
  event_sink: AgentRunRuntimeEventFactory;
  trace_logger?: AgentRunTraceLogger;
  on_model_call_started?: (input: { run_id: string; model_call_id: string }) => void;
  ids: {
    assistant_message_id(): string;
    approval_request_id(): string;
  };
  clock: { now(): string };
  limits: {
    max_model_calls: number;
    max_tool_rounds: number;
  };
};

export type RunOrchestratorRequest = {
  run: AgentRun;
  user_message_id: string;
  model_config: ModelCallConfig;
  permission_mode: PermissionMode;
  workspace_root?: string;
  initial_runtime_sources?: SessionContextSource[];
  initial_model_call_messages?: ModelCallMessage[];
  signal?: AbortSignal;
};

export type RunOrchestratorResult =
  | { status: 'completed'; run: AgentRun }
  | {
      status: 'waiting_for_approval';
      run: AgentRun;
      continuation: RunApprovalContinuation;
    }
  | { status: 'failed'; run: AgentRun; failure: AgentRunFailure };

export type RunApprovalContinuation = {
  run_id: string;
  pending_approval_ids: string[];
  original_approval_policy_by_approval_id: Record<string, Extract<PermissionDecision, { type: 'requires_approval' }>>;
  deferred_tool_calls: ModelRequestedToolCall[];
  user_message_id: string;
  model_config: RunOrchestratorRequest['model_config'];
  permission_mode: PermissionMode;
  workspace_root?: string;
  runtime_sources: SessionContextSource[];
  model_call_messages?: ModelCallMessage[];
};

export type ConsumeContextUsageSignalRequest = {
  signal: ContextUsageSignal;
  context_compaction_service: {
    compact(request: {
      session_id: string;
      workspace_id?: string;
      trigger: { kind: 'auto'; reason: 'context_window_threshold'; signal_id: string };
    }): Promise<CompactContextResult> | CompactContextResult;
  };
  event_sink: AgentRunRuntimeEventFactory;
};

export type ConsumeContextUsageSignalResult =
  | { status: 'ignored'; reason: 'not_auto_compaction_signal' }
  | { status: 'skipped'; reason: string }
  | { status: 'completed' }
  | { status: 'failed'; failure: AgentRunFailure };

export async function runAgentModelToolLoop(
  dependencies: RunOrchestratorDependencies,
  request: RunOrchestratorRequest,
): Promise<RunOrchestratorResult> {
  const toolSet = dependencies.tool_set_builder.getToolSet({ run_id: request.run.run_id });
  traceRun(dependencies, request.run, 'trace.tool_set.created', {
    tool_count: toolSet.items.length,
    tools: toolSet.items,
  });
  let run = request.run;
  let modelCalls = 0;
  let toolRounds = 0;
  const runtimeFacts: SessionContextSource[] = [...(request.initial_runtime_sources ?? [])];
  const modelCallMessages: ModelCallMessage[] = [...(request.initial_model_call_messages ?? [])];

  while (true) {
    if (modelCalls >= dependencies.limits.max_model_calls) {
      traceLoopCounters(dependencies, run, modelCalls, toolRounds, runtimeFacts.length);
      return failRun(dependencies, run, loopLimitFailure('maxModelCalls exceeded.'), {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }
    modelCalls += 1;

    const context = await dependencies.context_service.getSessionContext({
      session_id: run.session_id,
      workspace_id: run.workspace_id,
      purpose: 'agent_response',
    });
    if (context.status === 'failed') {
      return failRun(dependencies, run, {
        code: 'context_failed',
        message: context.failure.message,
      }, {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }

    const prompt = dependencies.context_service.buildPrompt({
      session_context: context.session_context,
      purpose: 'agent_response',
      current_user_message_id: request.user_message_id,
      runtime_sources: runtimeFacts,
    });
    if (prompt.status === 'failed') {
      return failRun(dependencies, run, {
        code: 'context_failed',
        message: prompt.failure.message,
      }, {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }
    traceRun(dependencies, run, 'trace.prompt.built', {
      model_call_index: modelCalls,
      prompt: prompt.prompt,
    });

    const modelCall = await dependencies.model_call_service.modelCall({
      owner: { type: 'agent_run', run_id: run.run_id },
      prompt: prompt.prompt as never,
      ...(modelCallMessages.length > 0 ? { model_call_messages: modelCallMessages } : {}),
      model_config: request.model_config as never,
      tool_set: toolSet,
      signal: request.signal,
    });
    if (modelCall.status === 'failed') {
      return failRun(dependencies, run, modelCall.failure, {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }
    dependencies.on_model_call_started?.({
      run_id: run.run_id,
      model_call_id: modelCall.model_call_id,
    });
    dependencies.event_sink.emit({
      eventType: 'model_call.started',
      run,
      payload: {
        modelCallId: modelCall.model_call_id,
        providerId: run.model_selection.provider_id,
        modelId: run.model_selection.model_id,
      },
    });
    traceRun(dependencies, run, 'trace.model_call.request_payload', {
      owner: { type: 'agent_run', run_id: run.run_id },
      model_config: request.model_config,
      tool_set: toolSet,
      prompt: prompt.prompt,
      model_call_messages: modelCallMessages,
    }, {
      model_call_id: modelCall.model_call_id,
    });

    const modelEvents = await collectModelCallEvents(dependencies, run, modelCall.events);
    if (modelEvents.failure) {
      return failRun(dependencies, run, modelEvents.failure, {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }

    if (modelEvents.tool_calls.length === 0) {
      const assistant = dependencies.session_service.saveAssistantMessage({
        message_id: dependencies.ids.assistant_message_id(),
        session_id: run.session_id,
        run_id: run.run_id,
        content_text: modelEvents.content,
        completed_at: dependencies.clock.now(),
      });
      if (assistant.status === 'failed') {
        return failRun(dependencies, run, {
          code: 'session_failed',
          message: assistant.failure.message,
        }, {
          model_calls: modelCalls,
          tool_rounds: toolRounds,
        });
      }
      run = dependencies.repository.saveRun(transitionAgentRunStatus({
        run,
        to: 'completed',
        changed_at: dependencies.clock.now(),
      }));
      dependencies.event_sink.emit({
        eventType: 'run.completed',
        run,
        messageId: assistant.message.message_id,
        payload: {
          assistantMessageId: assistant.message.message_id,
        },
      });
      traceRun(dependencies, run, 'run.completed', {
        assistant_message_id: assistant.message.message_id,
        content_preview: modelEvents.content,
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
      await dependencies.memory_service?.captureCompletedRun({
        run_id: run.run_id,
        session_id: run.session_id,
        workspace_id: run.workspace_id,
      });
      return { status: 'completed', run };
    }

    if (toolRounds >= dependencies.limits.max_tool_rounds) {
      traceLoopCounters(dependencies, run, modelCalls, toolRounds, runtimeFacts.length);
      return failRun(dependencies, run, loopLimitFailure('maxToolRounds exceeded.'), {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }
    toolRounds += 1;

    const permissionSettings = dependencies.settings_service.resolvePermissionSettings({
      workspace_id: run.workspace_id,
      session_id: run.session_id,
    });
    if (permissionSettings.status === 'failed') {
      return failRun(dependencies, run, {
        code: 'approval_failed',
        message: permissionSettings.failure.message,
      }, {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }

    const registeredTools = new Map(
      toolSet.items.flatMap((item) => {
        const tool = dependencies.tool_set_builder.getRegisteredTool(run.run_id, item.name);
        return tool ? [[item.name, tool] as const] : [];
      }),
    );
    for (const toolCall of modelEvents.tool_calls) {
      dependencies.event_sink.emit({
        eventType: 'tool_call.requested',
        run,
        payload: {
          ...(toolCall.model_call_id ? { modelCallId: toolCall.model_call_id } : {}),
          toolCallId: toolCall.tool_call_id,
          toolName: toolCall.tool_name,
          input: toJsonValue(toolCall.input),
        },
      });
    }
    traceRun(dependencies, run, 'trace.tool_call.requested', {
      model_call_index: modelCalls,
      tool_calls: modelEvents.tool_calls,
    });
    modelCallMessages.push({
      role: 'assistant',
      ...(modelEvents.content ? { content: modelEvents.content } : {}),
      tool_calls: modelEvents.tool_calls.map((toolCall) => ({
        tool_call_id: toolCall.tool_call_id,
        tool_name: toolCall.tool_name,
        arguments_text: toolCall.arguments_text,
      })),
    });
    const toolGroup = await orchestrateToolCallGroup({
      run_id: run.run_id,
      workspace_id: run.workspace_id,
      ...(request.workspace_root ? { workspace_root: request.workspace_root } : {}),
      permission_mode: request.permission_mode,
      permission_settings: permissionSettings.permission_settings,
      runtime_capability_policy: {
        custom_tools_enabled: true,
        process_execution_enabled: true,
        network_enabled: true,
      },
      tool_set: toolSet,
      tool_calls: modelEvents.tool_calls,
      registered_tools_by_name: registeredTools,
      permission_service: dependencies.permission_service,
      tool_execution_service: dependencies.tool_execution_service,
      ...(dependencies.trace_logger ? { trace_logger: dependencies.trace_logger } : {}),
      ...(dependencies.workspace_path_policy_service ? { workspace_path_policy_service: dependencies.workspace_path_policy_service } : {}),
      clock: dependencies.clock,
      ids: { approval_request_id: dependencies.ids.approval_request_id },
      signal: request.signal,
    });

    for (const toolCall of toolGroup.tool_calls) {
      emitToolCallTerminalEvent(dependencies, run, toolCall);
    }
    for (const toolResult of toolGroup.tool_result_facts) {
      emitToolResult(dependencies, run, toolResult);
      modelCallMessages.push(toolResultToModelCallMessage(toolResult));
    }
    if (toolGroup.tool_result_facts.length > 0) {
      traceRun(dependencies, run, 'trace.model_call.messages_appended', {
        added_count: toolGroup.tool_result_facts.length,
        model_call_messages: modelCallMessages.slice(-(toolGroup.tool_result_facts.length + 1)),
      });
    }
    for (const pendingApproval of toolGroup.pending_approvals) {
      const approval = pendingApproval.approval_request;
      dependencies.repository.createApprovalRequest(approval);
      dependencies.event_sink.emit({
        eventType: 'approval.requested',
        run,
        payload: {
          approvalRequest: approvalRequestToRuntimePayload(approval),
        },
      });
    }

    if (toolGroup.pending_approvals.length > 0) {
      run = dependencies.repository.saveRun(transitionAgentRunStatus({
        run,
        to: 'waiting_for_approval',
        changed_at: dependencies.clock.now(),
      }));
      dependencies.event_sink.emit({
        eventType: 'run.waiting_for_approval',
        run,
        payload: {
          approvalRequestId: toolGroup.pending_approvals[0]?.approval_request.approval_request_id ?? 'approval:unknown',
          toolCallId: toolGroup.pending_approvals[0]?.approval_request.subject.tool_call_id ?? 'tool-call:unknown',
          toolExecutionId: toolGroup.pending_approvals[0]?.approval_request.subject.tool_call_id ?? 'tool-call:unknown',
          reason: 'approval_required',
        },
      });
      traceLoopCounters(dependencies, run, modelCalls, toolRounds, runtimeFacts.length);
      return {
        status: 'waiting_for_approval',
        run,
        continuation: {
          run_id: run.run_id,
          pending_approval_ids: toolGroup.pending_approvals.map((approval) => approval.approval_request.approval_request_id),
          original_approval_policy_by_approval_id: Object.fromEntries(
            toolGroup.pending_approvals.map((approval) => [
              approval.approval_request.approval_request_id,
              approval.permission_decision,
            ]),
          ),
          deferred_tool_calls: toolGroup.deferred_tool_calls,
          user_message_id: request.user_message_id,
          model_config: request.model_config,
          permission_mode: request.permission_mode,
          ...(request.workspace_root ? { workspace_root: request.workspace_root } : {}),
          runtime_sources: runtimeFacts,
          model_call_messages: modelCallMessages,
        },
      };
    }

    traceLoopCounters(dependencies, run, modelCalls, toolRounds, runtimeFacts.length);
  }
}

function toolResultToModelCallMessage(toolResult: ToolResultRuntimeFact): ModelCallMessage {
  return {
    role: 'tool_result',
    tool_call_id: toolResult.tool_call_id,
    content: toolResult.content ?? toolResult.observation?.summary ?? `${toolResult.tool_name} ${toolResult.status}`,
  };
}

function sessionSourceRef(sessionId: string): { sourceRefId: string; sourceId: string; sourceKind: string; label: string } {
  return {
    sourceRefId: sessionId,
    sourceId: sessionId,
    sourceKind: 'session',
    label: 'Session context',
  };
}

function approvalRequestToRuntimePayload(request: AgentRunApprovalRequest): Record<string, unknown> {
  return {
    approvalRequestId: request.approval_request_id,
    runId: request.run_id,
    toolCallId: request.subject.tool_call_id,
    toolExecutionId: request.subject.tool_call_id,
    toolName: request.subject.tool_name,
    title: request.subject.tool_name,
    summary: request.summary ?? `${request.subject.tool_name} requires approval.`,
    requestedScope: request.requested_scope ?? 'once',
    preview: request.preview ?? {
      action: request.subject.tool_name,
      targets: [],
    },
    status: request.status,
    createdAt: request.created_at,
  };
}

export async function consumeContextUsageSignal(
  request: ConsumeContextUsageSignalRequest,
): Promise<ConsumeContextUsageSignalResult> {
  if (request.signal.kind !== 'auto_compaction_needed') {
    return { status: 'ignored', reason: 'not_auto_compaction_signal' };
  }

  request.event_sink.emit({
    eventType: 'context.compaction.started',
    sessionId: request.signal.session_id,
    payload: {
      compactionId: request.signal.signal_id,
      triggerReason: 'context_limit',
      tokensBefore: request.signal.usage.used_tokens,
      firstKeptSourceRef: sessionSourceRef(request.signal.session_id),
      summarizedSourceCount: 0,
    },
  });

  const result = await request.context_compaction_service.compact({
    session_id: request.signal.session_id,
    ...(request.signal.workspace_id ? { workspace_id: request.signal.workspace_id } : {}),
    trigger: {
      kind: 'auto',
      reason: 'context_window_threshold',
      signal_id: request.signal.signal_id,
    },
  });

  if (result.status === 'completed') {
    request.event_sink.emit({
      eventType: 'context.compaction.completed',
      sessionId: request.signal.session_id,
      payload: {
        compactionId: result.compaction.compaction_id,
        triggerReason: 'context_limit',
        tokensBefore: request.signal.usage.used_tokens,
        firstKeptSourceRef: sessionSourceRef(request.signal.session_id),
        summarizedSourceCount: 0,
      },
    });
    return { status: 'completed' };
  }

  if (result.status === 'skipped') {
    return { status: 'skipped', reason: result.reason };
  }

  request.event_sink.emit({
    eventType: 'context.compaction.failed',
    sessionId: request.signal.session_id,
    payload: {
      triggerReason: 'context_limit',
      tokensBefore: request.signal.usage.used_tokens,
      error: {
        code: 'context_budget_exceeded',
        message: result.failure.message,
        severity: 'error',
        retryable: false,
        source: 'core',
      },
    },
  });
  return {
    status: 'failed',
    failure: {
      code: 'context_failed',
      message: result.failure.message,
    },
  };
}

async function collectModelCallEvents(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  events: AsyncIterable<ModelCallEvent>,
): Promise<{
  content: string;
  tool_calls: ModelRequestedToolCall[];
  failure?: AgentRunFailure;
}> {
  const textDeltas: string[] = [];
  const toolCalls: ModelRequestedToolCall[] = [];
  let completedContent: string | undefined;
  const runtimeEventState: ModelCallRuntimeEventState = {};

  for await (const event of events) {
    emitModelCallRuntimeEvent(dependencies, run, event, runtimeEventState);
    dependencies.trace_logger?.record({
      trace_id: run.run_id,
      event_type: 'trace.model_call.event_received',
      run_id: run.run_id,
      session_id: run.session_id,
      workspace_id: run.workspace_id,
      model_call_id: event.model_call_id,
      ...(event.type === 'tool_call' ? { tool_call_id: event.tool_call_id } : {}),
      payload: { event },
    });
    if (event.type === 'text_delta') {
      textDeltas.push(event.delta);
    }
    if (event.type === 'tool_call') {
      toolCalls.push({
        model_call_id: event.model_call_id,
        tool_call_id: event.tool_call_id,
        tool_name: event.tool_name,
        input: event.input,
        arguments_text: event.arguments_text,
      });
    }
    if (event.type === 'completed') {
      completedContent = event.content;
    }
    if (event.type === 'failed') {
      return { content: '', tool_calls: [], failure: event.failure };
    }
  }

  return {
    content: completedContent ?? textDeltas.join(''),
    tool_calls: toolCalls,
  };
}

function emitModelCallRuntimeEvent(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  event: ModelCallEvent,
  state: ModelCallRuntimeEventState,
): void {
  if (event.type === 'started') {
    return;
  }

  if (event.type === 'retrying') {
    const retryRequestId = `retry:${event.model_call_id}:${event.attempt}`;
    state.activeRetryRequestId = retryRequestId;
    dependencies.event_sink.emit({
      eventType: 'retry.started',
      run,
      payload: {
        retryRequestId,
        retryKind: 'model_call',
      },
    });
    return;
  }

  if (event.type === 'text_delta') {
    dependencies.event_sink.emit({
      eventType: 'model_call.text_delta',
      run,
      payload: {
        modelCallId: event.model_call_id,
        delta: event.delta,
      },
    });
    return;
  }

  if (event.type === 'thinking_started') {
    dependencies.event_sink.emit({
      eventType: 'model.thinking.started',
      run,
      payload: {
        modelStepId: event.model_call_id,
      },
    });
    return;
  }

  if (event.type === 'thinking_delta') {
    dependencies.event_sink.emit({
      eventType: 'model.thinking.delta',
      run,
      payload: {
        modelStepId: event.model_call_id,
        delta: event.delta,
      },
    });
    return;
  }

  if (event.type === 'thinking_completed') {
    dependencies.event_sink.emit({
      eventType: 'model.thinking.completed',
      run,
      payload: {
        modelStepId: event.model_call_id,
      },
    });
    return;
  }

  if (event.type === 'tool_call') {
    dependencies.event_sink.emit({
      eventType: 'model_call.tool_call',
      run,
      payload: {
        modelCallId: event.model_call_id,
        toolCallId: event.tool_call_id,
        toolName: event.tool_name,
        input: toJsonValue(event.input),
      },
    });
    return;
  }

  if (event.type === 'completed') {
    if (state.activeRetryRequestId) {
      dependencies.event_sink.emit({
        eventType: 'retry.completed',
        run,
        payload: {
          retryRequestId: state.activeRetryRequestId,
          retryKind: 'model_call',
        },
      });
      state.activeRetryRequestId = undefined;
    }
    dependencies.event_sink.emit({
      eventType: 'model_call.completed',
      run,
      payload: {
        modelCallId: event.model_call_id,
        finishReason: event.finish_reason ?? 'stop',
        ...(event.content ? { content: event.content } : {}),
      },
    });
    return;
  }

  if (state.activeRetryRequestId) {
    dependencies.event_sink.emit({
      eventType: 'retry.failed',
      run,
      payload: {
        retryRequestId: state.activeRetryRequestId,
        retryKind: 'model_call',
        error: agentRunFailureToRuntimeError(event.failure),
      },
    });
    state.activeRetryRequestId = undefined;
  }
  dependencies.event_sink.emit({
    eventType: 'model_call.completed',
    run,
    payload: {
      modelCallId: event.model_call_id,
      finishReason: 'failed',
    },
  });
}

type ModelCallRuntimeEventState = {
  activeRetryRequestId?: string;
};

function emitToolCallTerminalEvent(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  toolCall: AgentRunToolCall,
): void {
  if (toolCall.status === 'completed') {
    dependencies.event_sink.emit({
      eventType: 'tool_call.completed',
      run,
      payload: {
        toolCallId: toolCall.tool_call_id,
        toolExecutionId: toolCall.tool_call_id,
        toolName: toolCall.tool_name,
      },
    });
    return;
  }

  if (toolCall.status === 'failed' || toolCall.status === 'denied') {
    dependencies.event_sink.emit({
      eventType: 'tool_call.failed',
      run,
      payload: {
        toolCallId: toolCall.tool_call_id,
        toolExecutionId: toolCall.tool_call_id,
        toolName: toolCall.tool_name,
        error: {
          code: toolCall.status === 'denied' ? 'approval_denied' : 'tool_execution_failed',
          message: toolCall.failure?.message ?? 'Tool call did not complete successfully.',
          severity: toolCall.status === 'denied' ? 'info' : 'error',
          retryable: false,
          source: toolCall.status === 'denied' ? 'approval' : 'tool',
        },
      },
    });
  }
}

function emitToolResult(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  toolResult: ToolResultRuntimeFact,
): void {
  dependencies.event_sink.emit({
    eventType: 'tool_result.created',
    run,
    payload: {
      toolResultId: `tool-result:${toolResult.tool_call_id}`,
      toolCallId: toolResult.tool_call_id,
      toolExecutionId: toolResult.tool_call_id,
      toolName: toolResult.tool_name,
      kind: toolResult.status === 'completed'
        ? 'success'
        : toolResult.status === 'denied'
          ? 'policy_denied'
          : toolResult.status === 'cancelled'
            ? 'user_rejected'
            : 'failed',
      ...(toolResult.content || toolResult.observation?.summary
        ? { summary: toolResult.content ?? toolResult.observation?.summary }
        : {}),
    },
  });
}

function failRun(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  failure: AgentRunFailure,
  counters?: { model_calls: number; tool_rounds: number },
): RunOrchestratorResult {
  const failedRun = dependencies.repository.saveRun(transitionAgentRunStatus({
    run,
    to: 'failed',
    changed_at: dependencies.clock.now(),
    failure,
  }));
  dependencies.event_sink.emit({
    eventType: 'run.failed',
    run: failedRun,
    payload: {
      error: agentRunFailureToRuntimeError(failure),
    },
  });
  traceRun(dependencies, failedRun, 'run.failed', {
    failure,
    ...(counters ? counters : {}),
  });
  return { status: 'failed', run: failedRun, failure };
}

function agentRunFailureToRuntimeError(failure: AgentRunFailure): RuntimeError {
  return {
    code: runtimeErrorCodeForAgentRunFailure(failure),
    message: failure.message,
    severity: 'error',
    retryable: failure.retryable ?? false,
    source: runtimeErrorSourceForAgentRunFailure(failure),
  };
}

function runtimeErrorCodeForAgentRunFailure(failure: AgentRunFailure): RuntimeError['code'] {
  switch (failure.code) {
    case 'context_failed':
      return 'context_budget_exceeded';
    case 'model_call_failed':
      return 'provider_invalid_request';
    case 'tool_call_failed':
      return 'tool_execution_failed';
    case 'approval_failed':
      return 'approval_denied';
    case 'cancel_failed':
      return 'runtime_cancelled';
    case 'runtime_protocol_violation':
    case 'loop_limit_exceeded':
      return 'runtime_protocol_violation';
    default:
      return 'runtime_unknown';
  }
}

function runtimeErrorSourceForAgentRunFailure(failure: AgentRunFailure): RuntimeError['source'] {
  if (failure.code === 'model_call_failed') return 'provider';
  if (failure.code === 'tool_call_failed') return 'tool';
  if (failure.code === 'approval_failed') return 'approval';
  return 'core';
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function loopLimitFailure(message: string): AgentRunFailure {
  return {
    code: 'loop_limit_exceeded',
    message,
  };
}

function traceRun(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  eventType: Parameters<AgentRunTraceLogger['record']>[0]['event_type'],
  payload: Record<string, unknown>,
  extra: Partial<Pick<Parameters<AgentRunTraceLogger['record']>[0], 'model_call_id' | 'tool_call_id'>> = {},
): void {
  dependencies.trace_logger?.record({
    trace_id: run.run_id,
    event_type: eventType,
    run_id: run.run_id,
    session_id: run.session_id,
    workspace_id: run.workspace_id,
    ...extra,
    payload,
  });
}

function traceLoopCounters(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  modelCalls: number,
  toolRounds: number,
  runtimeFactsCount: number,
): void {
  traceRun(dependencies, run, 'trace.loop.counters', {
    model_calls: modelCalls,
    tool_rounds: toolRounds,
    max_model_calls: dependencies.limits.max_model_calls,
    max_tool_rounds: dependencies.limits.max_tool_rounds,
    runtime_facts_count: runtimeFactsCount,
  });
}
