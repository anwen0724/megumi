/*
 * Runs the model/tool loop for one Agent Run.
 * It coordinates Context, Model Call, Tool Set, Permissions, and Session services.
 */
import type { PermissionMode, PermissionService } from '../../permissions';
import type { SessionService } from '../../session';
import type { SettingsService } from '../../settings';
import type { ToolExecutionService } from '../../tools';
import type { WorkspacePathPolicyService } from '../../workspace';
import type { CompactContextResult, ContextUsageSignal } from '../../context';
import type {
  AgentRun,
  AgentRunEvent,
  AgentRunFailure,
} from '../contracts/agent-run-contracts';
import type {
  ModelCallEvent,
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

export type RunOrchestratorDependencies = {
  repository: AgentRunRepository;
  session_service: Pick<SessionService, 'saveAssistantMessage'>;
  settings_service: Pick<SettingsService, 'resolvePermissionSettings'>;
  context_service: {
    getSessionContext(request: { session_id: string; workspace_id?: string; purpose?: 'agent_response' }): Promise<
      | { status: 'ok'; session_context: unknown }
      | { status: 'failed'; failure: { code: string; message: string } }
    >;
    buildPrompt(request: { session_context: unknown; purpose: 'agent_response'; current_user_message_id?: string }):
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
  event_sink: {
    emit(type: string, payload?: Record<string, unknown>): AgentRunEvent;
  };
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
  model_config: AgentRun['model_selection'] & Record<string, unknown>;
  permission_mode: PermissionMode;
  workspace_root?: string;
};

export type RunOrchestratorResult =
  | { status: 'completed'; run: AgentRun }
  | { status: 'waiting_for_approval'; run: AgentRun }
  | { status: 'failed'; run: AgentRun; failure: AgentRunFailure };

export type ConsumeContextUsageSignalRequest = {
  signal: ContextUsageSignal;
  context_compaction_service: {
    compact(request: {
      session_id: string;
      workspace_id?: string;
      trigger: { kind: 'auto'; reason: 'context_window_threshold'; signal_id: string };
    }): Promise<CompactContextResult> | CompactContextResult;
  };
  event_sink: {
    emit(type: string, payload?: Record<string, unknown>): AgentRunEvent;
  };
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
  let run = request.run;
  let modelCalls = 0;
  let toolRounds = 0;

  while (true) {
    if (modelCalls >= dependencies.limits.max_model_calls) {
      return failRun(dependencies, run, loopLimitFailure('maxModelCalls exceeded.'));
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
      });
    }

    const prompt = dependencies.context_service.buildPrompt({
      session_context: context.session_context,
      purpose: 'agent_response',
      current_user_message_id: request.user_message_id,
    });
    if (prompt.status === 'failed') {
      return failRun(dependencies, run, {
        code: 'context_failed',
        message: prompt.failure.message,
      });
    }

    const modelCall = await dependencies.model_call_service.modelCall({
      owner: { type: 'agent_run', run_id: run.run_id },
      prompt: prompt.prompt as never,
      model_config: request.model_config as never,
      tool_set: toolSet,
    });
    if (modelCall.status === 'failed') {
      return failRun(dependencies, run, modelCall.failure);
    }

    const modelEvents = await collectModelCallEvents(dependencies, modelCall.events);
    if (modelEvents.failure) {
      return failRun(dependencies, run, modelEvents.failure);
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
        });
      }
      run = dependencies.repository.saveRun(transitionAgentRunStatus({
        run,
        to: 'completed',
        changed_at: dependencies.clock.now(),
      }));
      dependencies.event_sink.emit('run.completed', {
        run_id: run.run_id,
        session_id: run.session_id,
        workspace_id: run.workspace_id,
      });
      await dependencies.memory_service?.captureCompletedRun({
        run_id: run.run_id,
        session_id: run.session_id,
        workspace_id: run.workspace_id,
      });
      return { status: 'completed', run };
    }

    if (toolRounds >= dependencies.limits.max_tool_rounds) {
      return failRun(dependencies, run, loopLimitFailure('maxToolRounds exceeded.'));
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
      });
    }

    const registeredTools = new Map(
      toolSet.items.flatMap((item) => {
        const tool = dependencies.tool_set_builder.getRegisteredTool(run.run_id, item.name);
        return tool ? [[item.name, tool] as const] : [];
      }),
    );
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
      ...(dependencies.workspace_path_policy_service ? { workspace_path_policy_service: dependencies.workspace_path_policy_service } : {}),
      clock: dependencies.clock,
      ids: { approval_request_id: dependencies.ids.approval_request_id },
    });

    for (const toolCall of toolGroup.tool_calls) {
      dependencies.event_sink.emit(`tool_call.${toolCall.status}`, {
        run_id: run.run_id,
        tool_call_id: toolCall.tool_call_id,
        tool_name: toolCall.tool_name,
      });
    }
    for (const toolResult of toolGroup.tool_result_facts) {
      emitToolResult(dependencies, run, toolResult);
    }
    for (const approval of toolGroup.pending_approvals) {
      dependencies.repository.createApprovalRequest(approval);
      dependencies.event_sink.emit('approval.requested', {
        run_id: run.run_id,
        approval_request_id: approval.approval_request_id,
      });
    }

    if (toolGroup.pending_approvals.length > 0) {
      run = dependencies.repository.saveRun(transitionAgentRunStatus({
        run,
        to: 'waiting_for_approval',
        changed_at: dependencies.clock.now(),
      }));
      dependencies.event_sink.emit('run.waiting_for_approval', { run_id: run.run_id });
      return { status: 'waiting_for_approval', run };
    }

    dependencies.event_sink.emit('tool_result_facts.submitted', {
      run_id: run.run_id,
      count: toolGroup.tool_result_facts.length,
    });
  }
}

export async function consumeContextUsageSignal(
  request: ConsumeContextUsageSignalRequest,
): Promise<ConsumeContextUsageSignalResult> {
  if (request.signal.kind !== 'auto_compaction_needed') {
    return { status: 'ignored', reason: 'not_auto_compaction_signal' };
  }

  request.event_sink.emit('context.compaction.requested', {
    session_id: request.signal.session_id,
    ...(request.signal.workspace_id ? { workspace_id: request.signal.workspace_id } : {}),
    signal_id: request.signal.signal_id,
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
    request.event_sink.emit('context.compaction.completed', {
      session_id: request.signal.session_id,
      ...(request.signal.workspace_id ? { workspace_id: request.signal.workspace_id } : {}),
      compaction_id: result.compaction.compaction_id,
    });
    return { status: 'completed' };
  }

  if (result.status === 'skipped') {
    request.event_sink.emit('context.compaction.skipped', {
      session_id: request.signal.session_id,
      reason: result.reason,
    });
    return { status: 'skipped', reason: result.reason };
  }

  request.event_sink.emit('context.compaction.failed', {
    session_id: request.signal.session_id,
    failure: result.failure,
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
  events: AsyncIterable<ModelCallEvent>,
): Promise<{
  content: string;
  tool_calls: ModelRequestedToolCall[];
  failure?: AgentRunFailure;
}> {
  const textDeltas: string[] = [];
  const toolCalls: ModelRequestedToolCall[] = [];
  let completedContent: string | undefined;

  for await (const event of events) {
    dependencies.event_sink.emit(`model_call.${event.type}`, { ...event });
    if (event.type === 'text_delta') {
      textDeltas.push(event.delta);
    }
    if (event.type === 'tool_call') {
      toolCalls.push({
        tool_call_id: event.tool_call_id,
        tool_name: event.tool_name,
        input: event.input,
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

function emitToolResult(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  toolResult: ToolResultRuntimeFact,
): void {
  dependencies.event_sink.emit('tool_result.created', {
    run_id: run.run_id,
    tool_call_id: toolResult.tool_call_id,
    tool_name: toolResult.tool_name,
    status: toolResult.status,
    content: toolResult.content,
  });
}

function failRun(
  dependencies: RunOrchestratorDependencies,
  run: AgentRun,
  failure: AgentRunFailure,
): RunOrchestratorResult {
  const failedRun = dependencies.repository.saveRun(transitionAgentRunStatus({
    run,
    to: 'failed',
    changed_at: dependencies.clock.now(),
    failure,
  }));
  dependencies.event_sink.emit('run.failed', {
    run_id: failedRun.run_id,
    session_id: failedRun.session_id,
    workspace_id: failedRun.workspace_id,
    failure,
  });
  return { status: 'failed', run: failedRun, failure };
}

function loopLimitFailure(message: string): AgentRunFailure {
  return {
    code: 'loop_limit_exceeded',
    message,
  };
}
