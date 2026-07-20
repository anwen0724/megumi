/*
 * Runs the model/tool loop for one Agent Run.
 * It coordinates Context, Model Call, Tool Set, Permissions, and Session services.
 */
import type { PermissionDecision, PermissionMode, PermissionService } from '../../permissions';
import { hasUserVisibleAssistantContent, type SessionService } from '../../session';
import type { AssistantContentBlock } from '@megumi/ai';
import type { SkillCatalogItem, UsedSkillContent } from '@megumi/skills';
import type { SettingsService } from '../../settings';
import type { ToolExecutionService } from '../../tools';
import type { WorkspacePathPolicyService } from '../../workspace';
import type {
  ContextCapacity,
  ContextService,
  CurrentConversationTurn,
  PreparedModelCall,
} from '../../context';
import type { JsonValue } from '../../shared-json';
import type { RuntimeError } from '../../events';
import type {
  AgentRun,
  AgentRunApprovalRequest,
  AgentRunFailure,
  ToolCallStep,
} from '../contracts/agent-run-contracts';
import type { AgentRunTraceLogger } from '../contracts/agent-run-trace-contracts';
import type {
  ModelCallEvent,
  ModelCallConfig,
  ModelCallService,
  ToolResultRuntimeFact,
} from '../contracts/model-call-contracts';
import { transitionAgentRunStatus } from './run-lifecycle';
import {
  orchestrateToolCallGroup,
  type ModelRequestedToolCall,
} from './tool-call-orchestrator';
import type { RunToolSetBuilder } from './tool-set-builder';
import type { AgentRunRuntimeEventFactory } from './agent-run-runtime-events';
import type { ActiveRunStore } from './active-run-store';
import { assistantReplyReasonForFailure, commitTerminalReply } from './terminal-reply';

export type RunOrchestratorDependencies = {
  active_run_store: Pick<ActiveRunStore,
    'getRun' | 'saveRun' | 'createApprovalRequest' | 'upsertStep'
    | 'getActiveModelResponse' | 'setActiveModelResponse' | 'updateActiveModelResponse'
    | 'clearActiveModelResponse' | 'getLastEntryId' | 'setLastEntryId'>;
  session_service: Pick<SessionService, 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'>;
  settings_service: Pick<SettingsService, 'resolvePermissionSettings'>;
  context_service: Pick<ContextService, 'prepareModelCall' | 'recordCompletedRunUsage'>;
  model_call_service: ModelCallService;
  tools_builder: RunToolSetBuilder;
  tool_execution_service: Pick<ToolExecutionService, 'executeTool'>;
  permission_service: Pick<PermissionService, 'evaluateToolCall'>;
  workspace_path_policy_service?: Pick<WorkspacePathPolicyService, 'classifyPath'>;
  memory_service?: {
    captureCompletedRun(request: { run_id: string; session_id: string; workspace_id: string }): Promise<unknown> | unknown;
  };
  event_sink: AgentRunRuntimeEventFactory;
  trace_logger?: AgentRunTraceLogger;
  on_model_call_started?: (input: { run_id: string; model_call_id: string }) => void;
  ids: {
    assistant_message_id(): string;
    tool_result_message_id(): string;
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
  current_turn: CurrentConversationTurn;
  skill_catalog: SkillCatalogItem[];
  used_skills: UsedSkillContent[];
  model_context: ContextCapacity;
  model_config: ModelCallConfig;
  permission_mode: PermissionMode;
  workspace_root?: string;
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
  deferred_call_order_offset: number;
  current_turn: CurrentConversationTurn;
  skill_catalog: SkillCatalogItem[];
  used_skills: UsedSkillContent[];
  model_context: ContextCapacity;
  model_config: RunOrchestratorRequest['model_config'];
  permission_mode: PermissionMode;
  workspace_root?: string;
};

export async function runAgentModelToolLoop(
  dependencies: RunOrchestratorDependencies,
  request: RunOrchestratorRequest,
): Promise<RunOrchestratorResult> {
  const tools = dependencies.tools_builder.getToolSet({ run_id: request.run.run_id });
  traceRun(dependencies, request.run, 'trace.tools.created', {
    tool_count: tools.length,
    tools,
  });
  let run = request.run;
  let modelCalls = 0;
  let toolRounds = 0;
  let currentTurn: CurrentConversationTurn = {
    ...request.current_turn,
    runItems: [...request.current_turn.runItems],
  };
  let usedSkills = request.used_skills.map((skill) => ({ ...skill }));
  let lastPrepared: PreparedModelCall | undefined;
  let lastProviderInputTokens: number | undefined;
  let protocolRepairs = 0;

  while (true) {
    if (modelCalls >= dependencies.limits.max_model_calls) {
      traceLoopCounters(dependencies, run, modelCalls, toolRounds, currentTurn.runItems.length);
      return failRun(dependencies, run, loopLimitFailure('maxModelCalls exceeded.'), {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }
    modelCalls += 1;

    const preparation = await dependencies.context_service.prepareModelCall({
      sessionId: run.session_id,
      workspaceId: run.workspace_id,
      currentTurn,
      skillCatalog: request.skill_catalog,
      usedSkills,
      tools,
      modelContext: request.model_context,
      imageInputSupport: request.model_config.capabilities.imageInput,
      onCompactionProgress: (progress) => emitContextCompactionProgress(dependencies, run, progress),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (preparation.status === 'failed') {
      return failRun(dependencies, run, {
        code: 'context_failed',
        message: preparation.failure.message,
      }, {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }

    lastPrepared = preparation.prepared;
    traceRun(dependencies, run, 'trace.prompt.built', {
      model_call_index: modelCalls,
      ...preparedModelCallTraceMetadata(lastPrepared),
    });

    const modelCall = await dependencies.model_call_service.modelCall({
      owner: { type: 'agent_run', run_id: run.run_id },
      prompt: lastPrepared.prompt,
      model_config: request.model_config,
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
    const responseMessageId = dependencies.ids.assistant_message_id();
    dependencies.active_run_store.setActiveModelResponse({
      run_id: run.run_id,
      model_call_id: modelCall.model_call_id,
      message_id: responseMessageId,
      parent_entry_id: currentTurn.lastEntryId ?? currentTurn.userEntry.entryId,
      content: [],
      has_pending_work_tool_call: false,
    });
    const modelCallStartedAt = dependencies.clock.now();
    dependencies.active_run_store.upsertStep({
      type: 'model_call',
      run_id: run.run_id,
      model_call_id: modelCall.model_call_id,
      status: 'running',
      started_at: modelCallStartedAt,
    });
    dependencies.event_sink.emit({
      eventType: 'model_call.started',
      run,
      messageId: responseMessageId,
      payload: {
        modelCallId: modelCall.model_call_id,
        providerId: run.model_selection.provider_id,
        modelId: run.model_selection.model_id,
      },
    });
    traceRun(dependencies, run, 'trace.model_call.request_payload', {
      owner_type: 'agent_run',
      provider_id: request.model_config.provider_id,
      model_id: request.model_config.model_id,
      ...preparedModelCallTraceMetadata(lastPrepared),
    }, {
      model_call_id: modelCall.model_call_id,
    });

    const modelEvents = await collectModelCallEvents(dependencies, run, modelCall.events);
    lastProviderInputTokens = modelEvents.provider_input_tokens;
    const latestRun = dependencies.active_run_store.getRun(run.run_id);
    if (latestRun?.status === 'cancelled') {
      return {
        status: 'failed',
        run: latestRun,
        failure: { code: 'cancel_failed', message: 'Agent Run was cancelled.' },
      };
    }
    if (modelEvents.failure) {
      dependencies.active_run_store.upsertStep({
        type: 'model_call',
        run_id: run.run_id,
        model_call_id: modelCall.model_call_id,
        status: 'failed',
        started_at: modelCallStartedAt,
        completed_at: dependencies.clock.now(),
        failure: modelEvents.failure,
      });
      if (modelEvents.failure.details?.reason === 'malformed_work_tool_call' && protocolRepairs < 1) {
        protocolRepairs += 1;
        dependencies.active_run_store.clearActiveModelResponse(run.run_id);
        currentTurn = appendProtocolRepair(currentTurn);
        continue;
      }
      return failRun(dependencies, run, modelEvents.failure, {
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
    }
    dependencies.active_run_store.upsertStep({
      type: 'model_call',
      run_id: run.run_id,
      model_call_id: modelCall.model_call_id,
      status: 'completed',
      started_at: modelCallStartedAt,
      completed_at: dependencies.clock.now(),
    });

    if (shouldRepairModelResponse(modelEvents)) {
      if (protocolRepairs < 1) {
        protocolRepairs += 1;
        dependencies.active_run_store.clearActiveModelResponse(run.run_id);
        currentTurn = appendProtocolRepair(currentTurn);
        continue;
      }
      return failRun(dependencies, run, {
        code: 'runtime_protocol_violation',
        message: 'Model response did not produce a valid final reply or actionable tool call.',
      }, { model_calls: modelCalls, tool_rounds: toolRounds });
    }

    if (modelEvents.tool_calls.length === 0) {
      const reply = commitTerminalReply({
        dependencies,
        run,
        status: 'completed',
        reason_code: 'normal_completion',
      });
      if (reply.status === 'failed') {
        return failRunWithoutTerminalEvent(dependencies, run, {
          code: 'session_failed',
          message: reply.message,
        });
      }
      run = dependencies.active_run_store.saveRun(transitionAgentRunStatus({
        run,
        to: 'completed',
        changed_at: dependencies.clock.now(),
      }));
      dependencies.event_sink.emit({
        eventType: 'run.completed',
        run,
        messageId: reply.message_id,
        payload: {
          assistantMessageId: reply.message_id,
        },
      });
      traceRun(dependencies, run, 'run.completed', {
        assistant_message_id: reply.message_id,
        content_preview: modelEvents.content,
        model_calls: modelCalls,
        tool_rounds: toolRounds,
      });
      try {
        const snapshot = dependencies.context_service.recordCompletedRunUsage({
          sessionId: run.session_id,
          runId: run.run_id,
          modelContext: request.model_context,
          preCallUsage: lastPrepared.usage,
          ...(lastProviderInputTokens !== undefined ? { providerInputTokens: lastProviderInputTokens } : {}),
        });
        if (snapshot.status === 'failed') {
          traceRun(dependencies, run, 'trace.context.snapshot_failed', {
            code: snapshot.failure.code,
          });
        }
      } catch {
        traceRun(dependencies, run, 'trace.context.snapshot_failed', {
          code: 'snapshot_write_failed',
        });
      }
      try {
        await dependencies.memory_service?.captureCompletedRun({
          run_id: run.run_id,
          session_id: run.session_id,
          workspace_id: run.workspace_id,
        });
      } catch {
        traceRun(dependencies, run, 'trace.memory.capture_failed', {
          reason: 'post_run_capture_failed',
        });
      }
      return { status: 'completed', run };
    }

    const response = dependencies.session_service.saveModelResponse({
      message_id: responseMessageId,
      session_id: run.session_id,
      run_id: run.run_id,
      parent_entry_id: currentTurn.lastEntryId ?? currentTurn.userEntry.entryId,
      content: modelEvents.assistant_content,
      outcome_status: 'completed',
      ...(modelEvents.stop_reason ? { stop_reason: modelEvents.stop_reason } : {}),
      completed_at: dependencies.clock.now(),
    });
    if (response.status === 'failed') {
      return failRun(dependencies, run, {
        code: 'session_failed',
        message: response.failure.message,
      }, { model_calls: modelCalls, tool_rounds: toolRounds });
    }
    dependencies.active_run_store.setLastEntryId(run.run_id, response.entry.entry_id);
    dependencies.active_run_store.clearActiveModelResponse(run.run_id);
    currentTurn = { ...currentTurn, lastEntryId: response.entry.entry_id };

    if (toolRounds >= dependencies.limits.max_tool_rounds) {
      traceLoopCounters(dependencies, run, modelCalls, toolRounds, currentTurn.runItems.length);
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
      tools.flatMap((item) => {
        const tool = dependencies.tools_builder.getRegisteredTool(run.run_id, item.name);
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
    const appendedItems: CurrentConversationTurn['runItems'] = [];
    if (modelEvents.content) {
      appendedItems.push({ type: 'assistant_message', content: [{ type: 'text', text: modelEvents.content }] });
    }
    appendedItems.push(...modelEvents.tool_calls.map((toolCall) => ({
      type: 'tool_call' as const,
      toolCallId: toolCall.tool_call_id,
      toolName: toolCall.tool_name,
      arguments: toJsonValue(toolCall.input),
    })));
    const toolGroup = await orchestrateToolCallGroup({
      run_id: run.run_id,
      session_id: run.session_id,
      workspace_id: run.workspace_id,
      ...(request.workspace_root ? { workspace_root: request.workspace_root } : {}),
      permission_mode: request.permission_mode,
      permission_settings: permissionSettings.permission_settings,
      tools,
      tool_calls: modelEvents.tool_calls,
      registered_tools_by_name: registeredTools,
      permission_service: dependencies.permission_service,
      tool_execution_service: dependencies.tool_execution_service,
      ...(dependencies.trace_logger ? { trace_logger: dependencies.trace_logger } : {}),
      ...(dependencies.workspace_path_policy_service ? { workspace_path_policy_service: dependencies.workspace_path_policy_service } : {}),
      clock: dependencies.clock,
      ids: { approval_request_id: dependencies.ids.approval_request_id },
      on_step_transition: (step) => {
        if (dependencies.active_run_store.getRun(step.run_id)?.status !== 'cancelled') {
          dependencies.active_run_store.upsertStep(step);
        }
      },
      signal: request.signal,
    });

    for (const toolCall of toolGroup.tool_calls) {
      emitToolCallTerminalEvent(dependencies, run, toolCall);
    }
    for (const toolResult of toolGroup.tool_result_facts) {
      emitToolResult(dependencies, run, toolResult);
      const persisted = dependencies.session_service.saveToolResultMessage({
        message_id: dependencies.ids.tool_result_message_id(),
        session_id: run.session_id,
        run_id: run.run_id,
        parent_entry_id: currentTurn.lastEntryId ?? currentTurn.userEntry.entryId,
        tool_call_id: toolResult.tool_call_id,
        tool_name: toolResult.tool_name,
        status: toolResult.status,
        ...(toolResult.error ? { error: toolResult.error } : {}),
        content: [{
          type: 'text',
          text: toolResult.content ?? toolResult.observation?.summary ?? `${toolResult.tool_name} ${toolResult.status}`,
        }],
        completed_at: toolResult.created_at,
      });
      if (persisted.status === 'failed') {
        return failRun(dependencies, run, {
          code: 'session_failed', message: persisted.failure.message,
        }, { model_calls: modelCalls, tool_rounds: toolRounds });
      }
      currentTurn = { ...currentTurn, lastEntryId: persisted.entry.entry_id };
      dependencies.active_run_store.setLastEntryId(run.run_id, persisted.entry.entry_id);
      appendedItems.push(toolResultToConversationItem(toolResult));
    }
    if (toolGroup.tool_result_facts.length > 0) {
      traceRun(dependencies, run, 'trace.model_call.messages_appended', {
        added_count: toolGroup.tool_result_facts.length,
        run_items: appendedItems,
      });
    }
    currentTurn = { ...currentTurn, runItems: [...currentTurn.runItems, ...appendedItems] };
    usedSkills = mergeUsedSkillSources(usedSkills, toolGroup.tool_result_facts);
    const afterToolGroup = dependencies.active_run_store.getRun(run.run_id);
    if (afterToolGroup?.status === 'cancelled') {
      return {
        status: 'failed',
        run: afterToolGroup,
        failure: { code: 'cancel_failed', message: 'Agent Run was cancelled.' },
      };
    }
    for (const pendingApproval of toolGroup.pending_approvals) {
      const approval = pendingApproval.approval_request;
      dependencies.active_run_store.createApprovalRequest(approval);
      dependencies.event_sink.emit({
        eventType: 'approval.requested',
        run,
        payload: {
          approvalRequest: approvalRequestToRuntimePayload(approval),
        },
      });
    }

    if (toolGroup.pending_approvals.length > 0) {
      run = dependencies.active_run_store.saveRun(transitionAgentRunStatus({
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
      traceLoopCounters(dependencies, run, modelCalls, toolRounds, currentTurn.runItems.length);
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
          deferred_call_order_offset: toolGroup.deferred_call_order_offset,
          current_turn: currentTurn,
          skill_catalog: request.skill_catalog,
          used_skills: usedSkills,
          model_context: request.model_context,
          model_config: request.model_config,
          permission_mode: request.permission_mode,
          ...(request.workspace_root ? { workspace_root: request.workspace_root } : {}),
        },
      };
    }

    traceLoopCounters(dependencies, run, modelCalls, toolRounds, currentTurn.runItems.length);
  }
}

function mergeUsedSkillSources(
  current: UsedSkillContent[],
  toolResults: ToolResultRuntimeFact[],
): UsedSkillContent[] {
  const byPath = new Map(current.map((skill) => [skill.skillPath, skill]));
  for (const source of toolResults.flatMap((result) => result.runtimeSources ?? [])) {
    if (source.source_kind !== 'skill') continue;
    const name = source.metadata?.name;
    const skillPath = source.metadata?.skillPath;
    if (typeof name !== 'string' || typeof skillPath !== 'string') continue;
    byPath.set(skillPath, { name, skillPath, content: source.text });
  }
  return [...byPath.values()];
}

function emitContextCompactionProgress(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  progress: import('../../context').ContextCompactionProgress,
): void {
  if (progress.status === 'failed') {
    dependencies.event_sink.emit({
      eventType: 'context.compaction.failed',
      run,
      payload: {
        compactionId: progress.compactionId,
        triggerReason: 'automatic',
        tokensBefore: progress.tokensBefore,
        ...(progress.previousCompactionId ? { previousCompactionId: progress.previousCompactionId } : {}),
        error: {
          code: 'context_budget_exceeded',
          message: progress.message,
          severity: 'error',
          retryable: true,
          source: 'core',
        },
      },
    });
    return;
  }

  dependencies.event_sink.emit({
    eventType: progress.status === 'started'
      ? 'context.compaction.started'
      : 'context.compaction.completed',
    run,
    payload: {
      compactionId: progress.compactionId,
      triggerReason: 'automatic',
      tokensBefore: progress.tokensBefore,
      firstKeptSourceRef: {
        ...(progress.firstKeptSourceId ? { sourceId: progress.firstKeptSourceId } : {}),
        sourceKind: 'session_message',
      },
      summarizedSourceCount: progress.summarizedSourceCount,
      ...(progress.previousCompactionId ? { previousCompactionId: progress.previousCompactionId } : {}),
    },
  });
}

function toolResultToConversationItem(toolResult: ToolResultRuntimeFact): CurrentConversationTurn['runItems'][number] {
  return {
    type: 'tool_result',
    toolCallId: toolResult.tool_call_id,
    toolName: toolResult.tool_name,
    status: toolResult.status === 'success' ? 'success' : 'failure',
    content: [{ type: 'text', text: toolResult.content ?? toolResult.observation?.summary ?? `${toolResult.tool_name} ${toolResult.status}` }],
  };
}

function approvalRequestToRuntimePayload(request: AgentRunApprovalRequest): Record<string, unknown> {
  return {
    approvalRequestId: request.approval_request_id,
    runId: request.run_id,
    toolCallId: request.subject.tool_call_id,
    toolExecutionId: request.subject.tool_call_id,
    toolName: request.subject.tool_name,
    ...(request.subject.tool_identity ? {
      toolIdentity: {
        sourceId: request.subject.tool_identity.source_id,
        namespace: request.subject.tool_identity.namespace,
        sourceToolName: request.subject.tool_identity.source_tool_name,
      },
    } : {}),
    title: request.subject.tool_name,
    summary: request.summary ?? `${request.subject.tool_name} requires approval.`,
    options: request.options,
    defaultOptionId: request.default_option_id,
    preview: request.preview ?? {
      action: request.subject.tool_name,
      targets: [],
    },
    ...(request.operations ? { operations: request.operations } : {}),
    status: request.status,
    createdAt: request.created_at,
  };
}

async function collectModelCallEvents(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  events: AsyncIterable<ModelCallEvent>,
): Promise<{
  content: string;
  assistant_content: AssistantContentBlock[];
  tool_calls: ModelRequestedToolCall[];
  stop_reason?: string;
  provider_input_tokens?: number;
  completed_event_received: boolean;
  failure?: AgentRunFailure;
}> {
  const textDeltas: string[] = [];
  const thinkingDeltas: string[] = [];
  const assistantContent: AssistantContentBlock[] = [];
  const toolCalls: ModelRequestedToolCall[] = [];
  let completedContent: string | undefined;
  let providerInputTokens: number | undefined;
  let stopReason: string | undefined;
  let completedEventReceived = false;
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
    if (event.type === 'thinking_delta') {
      thinkingDeltas.push(event.delta);
    }
    if (event.type === 'thinking_completed' && thinkingDeltas.length > 0) {
      assistantContent.push({ type: 'thinking', thinking: thinkingDeltas.join('') });
      thinkingDeltas.length = 0;
    }
    if (event.type === 'tool_call') {
      if (textDeltas.length > 0) {
        assistantContent.push({ type: 'text', text: textDeltas.join('') });
        textDeltas.length = 0;
      }
      assistantContent.push({
        type: 'toolCall', id: event.tool_call_id, name: event.tool_name,
        argumentsText: event.arguments_text,
      });
      toolCalls.push({
        model_call_id: event.model_call_id,
        tool_call_id: event.tool_call_id,
        tool_name: event.tool_name,
        input: event.input,
        arguments_text: event.arguments_text,
      });
    }
    if (event.type === 'completed') {
      completedEventReceived = true;
      completedContent = event.content;
      stopReason = event.finish_reason;
      providerInputTokens = event.usage?.input_tokens;
    }
    if (event.type === 'failed') {
      flushAssistantText(assistantContent, textDeltas, completedContent);
      const hasPendingWorkToolIntent = toolCalls.length > 0
        || event.failure.details?.reason === 'malformed_work_tool_call';
      dependencies.active_run_store.updateActiveModelResponse(run.run_id, {
        content: [...assistantContent],
        has_pending_work_tool_call: hasPendingWorkToolIntent,
      });
      return {
        content: completedContent ?? textDeltas.join(''),
        assistant_content: assistantContent,
        tool_calls: toolCalls,
        completed_event_received: completedEventReceived,
        ...(stopReason ? { stop_reason: stopReason } : {}),
        failure: event.failure,
      };
    }
    dependencies.active_run_store.updateActiveModelResponse(run.run_id, {
      content: activeDraftContent(assistantContent, textDeltas, thinkingDeltas, completedContent),
      has_pending_work_tool_call: toolCalls.length > 0,
    });
  }

  flushAssistantText(assistantContent, textDeltas, completedContent);
  return {
    content: completedContent ?? assistantContent.flatMap((block) => block.type === 'text' ? [block.text] : []).join(''),
    assistant_content: assistantContent,
    tool_calls: toolCalls,
    completed_event_received: completedEventReceived,
    ...(stopReason ? { stop_reason: stopReason } : {}),
    ...(providerInputTokens !== undefined ? { provider_input_tokens: providerInputTokens } : {}),
  };
}

function activeDraftContent(
  committed: AssistantContentBlock[],
  textDeltas: string[],
  thinkingDeltas: string[],
  completedContent?: string,
): AssistantContentBlock[] {
  const content = [...committed];
  if (thinkingDeltas.length > 0) {
    content.push({ type: 'thinking', thinking: thinkingDeltas.join('') });
  }
  const text = completedContent ?? textDeltas.join('');
  if (text && !content.some((block) => block.type === 'text' && block.text === text)) {
    const firstToolCall = content.findIndex((block) => block.type === 'toolCall');
    if (firstToolCall >= 0) content.splice(firstToolCall, 0, { type: 'text', text });
    else content.push({ type: 'text', text });
  }
  return content;
}

function shouldRepairModelResponse(response: {
  assistant_content: AssistantContentBlock[];
  tool_calls: ModelRequestedToolCall[];
  stop_reason?: string;
  completed_event_received: boolean;
}): boolean {
  if (!response.completed_event_received) return true;
  const finishReason = response.stop_reason?.toLowerCase();
  if (finishReason && [
    'length',
    'max_tokens',
    'incomplete',
    'cancelled',
    'canceled',
    'aborted',
    'error',
    'content_filter',
  ].includes(finishReason)) {
    return true;
  }
  return response.tool_calls.length === 0
    && !hasUserVisibleAssistantContent(response.assistant_content);
}

function appendProtocolRepair(currentTurn: CurrentConversationTurn): CurrentConversationTurn {
  return {
    ...currentTurn,
    runItems: [...currentTurn.runItems, {
      type: 'context',
      kind: 'historical_run_state',
      content: {
        status: 'protocol_repair',
        instruction: 'Return one user-visible final response, or issue a valid Work Tool Call.',
      },
    }],
  };
}

function flushAssistantText(
  content: AssistantContentBlock[],
  textDeltas: string[],
  completedContent?: string,
): void {
  const streamed = textDeltas.join('');
  const text = completedContent ?? streamed;
  if (text && !content.some((block) => block.type === 'text' && block.text === text)) {
    const firstToolCall = content.findIndex((block) => block.type === 'toolCall');
    if (firstToolCall >= 0) content.splice(firstToolCall, 0, { type: 'text', text });
    else content.push({ type: 'text', text });
  } else if (streamed && !content.some((block) => block.type === 'text' && block.text === streamed)) {
    content.push({ type: 'text', text: streamed });
  }
  textDeltas.length = 0;
}

function emitModelCallRuntimeEvent(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  event: ModelCallEvent,
  state: ModelCallRuntimeEventState,
): void {
  const messageId = dependencies.active_run_store.getActiveModelResponse(run.run_id)?.message_id;
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
      ...(messageId ? { messageId } : {}),
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
      ...(messageId ? { messageId } : {}),
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
      ...(messageId ? { messageId } : {}),
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
      ...(messageId ? { messageId } : {}),
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
      ...(messageId ? { messageId } : {}),
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
      ...(messageId ? { messageId } : {}),
      payload: {
        modelCallId: event.model_call_id,
        finishReason: event.finish_reason ?? 'stop',
        ...(event.content ? { content: [{ type: 'text' as const, text: event.content }] } : {}),
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
    ...(messageId ? { messageId } : {}),
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
  toolCall: ToolCallStep,
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
      kind: toolResult.status,
      content: [{
        type: 'text',
        text: toolResult.content ?? toolResult.observation?.summary ?? `${toolResult.tool_name} ${toolResult.status}`,
      }],
      ...(toolResult.error ? { error: toolResult.error } : {}),
    },
  });
}

function failRun(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  failure: AgentRunFailure,
  counters?: { model_calls: number; tool_rounds: number },
): RunOrchestratorResult {
  const reply = commitTerminalReply({
    dependencies,
    run,
    status: 'failed',
    reason_code: assistantReplyReasonForFailure(failure),
  });
  if (reply.status === 'failed') {
    return failRunWithoutTerminalEvent(dependencies, run, {
      code: 'session_failed',
      message: reply.message,
    });
  }
  const failedRun = dependencies.active_run_store.saveRun(transitionAgentRunStatus({
    run,
    to: 'failed',
    changed_at: dependencies.clock.now(),
    failure,
  }));
  dependencies.event_sink.emit({
    eventType: 'run.failed',
    run: failedRun,
    messageId: reply.message_id,
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

function failRunWithoutTerminalEvent(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  failure: AgentRunFailure,
): RunOrchestratorResult {
  const failedRun = dependencies.active_run_store.saveRun(transitionAgentRunStatus({
    run,
    to: 'failed',
    changed_at: dependencies.clock.now(),
    failure,
  }));
  traceRun(dependencies, failedRun, 'run.failed', {
    failure,
    terminal_reply_commit_failed: true,
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

function preparedModelCallTraceMetadata(prepared: PreparedModelCall): Record<string, unknown> {
  return {
    preparation_id: prepared.preparationId,
    usage: { ...prepared.usage },
    source_count: prepared.sourceRefs.length,
    source_type_counts: countBy(prepared.sourceRefs.map((source) => source.sourceType)),
    system_instruction_count: prepared.prompt.instructions.system.length,
    agent_instruction_count: prepared.prompt.instructions.agentInstructions.sources.length,
    used_skill_count: prepared.prompt.runContext.skills.length,
    skill_catalog_count: prepared.prompt.referenceContext.skillCatalog.length,
    memory_item_count: prepared.prompt.referenceContext.memoryRecall?.items.length ?? 0,
    conversation_item_count: prepared.prompt.conversation.length,
    conversation_item_type_counts: countBy(prepared.prompt.conversation.map((item) => item.type)),
    tool_count: prepared.prompt.tools.length,
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
