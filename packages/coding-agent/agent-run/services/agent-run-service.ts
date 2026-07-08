/*
 * Public Agent Run Service factory.
 * It owns user-input-to-run orchestration and delegates model/tool looping to core.
 */
import type { CommandExecutionContext, CommandExecutionResult } from '../../commands';
import type { InputService, ParsedUserInput } from '../../input';
import type { PermissionMode, PermissionService } from '../../permissions';
import type { SessionService } from '../../session';
import type { SettingsService } from '../../settings';
import type { ToolExecutionService, ToolRegistryService } from '../../tools';
import type { WorkspacePathPolicyService, WorkspaceService } from '../../workspace';
import type { CompactContextResult, ContextUsageSignal, SessionContextSource } from '../../context';
import type { MegumiDatabase } from '../../persistence/connection';
import type {
  AgentRun,
  AgentRunApprovalRequest,
  AgentRunEvent,
  AgentRunFailure,
  AgentRunService,
  CancelRunRequest,
  CancelRunResult,
  CleanupInterruptedRunsRequest,
  CleanupInterruptedRunsResult,
  ResumeRunAfterApprovalRequest,
  ResumeRunAfterApprovalResult,
  StartRunRequest,
  StartRunResult,
} from '../contracts/agent-run-contracts';
import type { AgentRunTraceLogger } from '../contracts/agent-run-trace-contracts';
import type { ModelCallConfig, ModelCallService, ToolResultRuntimeFact } from '../contracts/model-call-contracts';
import {
  consumeContextUsageSignal,
  runAgentModelToolLoop,
  type RunApprovalContinuation,
} from '../core/run-orchestrator';
import {
  orchestrateToolCallGroup,
  type ModelRequestedToolCall,
} from '../core/tool-call-orchestrator';
import { transitionAgentRunStatus } from '../core/run-lifecycle';
import {
  createRunToolSetBuilder,
  type RunToolSetBuilder,
} from '../core/tool-set-builder';
import { cleanupInterruptedRuns as cleanupInterruptedRunsCore } from '../core/run-recovery';
import { resumeApprovalFlow } from '../core/approval-flow';
import {
  createAgentRunRepository,
  type AgentRunRepository,
} from '../repositories/agent-run-repository';
import { createNoopAgentRunTraceLogger } from './agent-run-trace-logger';

export type CreateAgentRunServiceOptions = {
  repository?: AgentRunRepository;
  database?: MegumiDatabase;
  input_service: Pick<InputService, 'processUserInput'>;
  command_service: {
    handleCommandInput(request: { raw_input: string; execution_context?: CommandExecutionContext }): Promise<CommandExecutionResult>;
  };
  command_execution_context_provider?: (input: {
    request: StartRunRequest;
    session_id: string;
  }) => CommandExecutionContext | undefined;
  session_service: Pick<SessionService, 'createSession' | 'getSession' | 'saveUserMessage' | 'saveAssistantMessage'>;
  settings_service: Pick<SettingsService, 'resolveProviderRuntimeConfig' | 'resolvePermissionSettings'>;
  context_service: Parameters<typeof runAgentModelToolLoop>[0]['context_service'];
  model_call_service: ModelCallService;
  tool_registry_service: Pick<ToolRegistryService, 'listAvailableTools'>;
  tool_execution_service?: Pick<ToolExecutionService, 'executeTool'>;
  tool_execution_service_factory?: (input: {
    run_id: string;
    session_id: string;
    workspace_id: string;
    workspace_root?: string;
  }) => Pick<ToolExecutionService, 'executeTool'>;
  permission_service: Pick<PermissionService, 'evaluateToolExecution' | 'validateApprovalDecision' | 'applyApprovalDecision'>;
  workspace_service?: Pick<WorkspaceService, 'getWorkspace'>;
  workspace_path_policy_service?: Pick<WorkspacePathPolicyService, 'classifyPath'>;
  memory_service?: Parameters<typeof runAgentModelToolLoop>[0]['memory_service'];
  context_usage_signal_bus?: {
    subscribe(
      signalKind: 'auto_compaction_needed',
      handler: (signal: ContextUsageSignal) => void | Promise<void>,
    ): () => void;
  };
  context_usage_monitor?: {
    markCompactionRunning(input: { session_id: string; workspace_id?: string; running: boolean }): void;
  };
  context_compaction_service?: {
    compact(request: {
      session_id: string;
      workspace_id?: string;
      trigger: { kind: 'auto'; reason: 'context_window_threshold'; signal_id: string };
    }): Promise<CompactContextResult> | CompactContextResult;
  };
  event_publisher?: {
    publish(event: AgentRunEvent): AgentRunEvent | void;
  };
  trace_logger?: AgentRunTraceLogger;
  ids?: Partial<AgentRunServiceIds>;
  clock?: { now(): string };
  limits?: Partial<AgentRunLoopLimits>;
};

type AgentRunServiceIds = {
  run_id(): string;
  session_id(): string;
  user_message_id(): string;
  assistant_message_id(): string;
  approval_request_id(): string;
  event_id(): string;
};

type AgentRunLoopLimits = {
  max_model_calls: number;
  max_tool_rounds: number;
};

export function createAgentRunService(options: CreateAgentRunServiceOptions): AgentRunService {
  return new DefaultAgentRunService(options);
}

class DefaultAgentRunService implements AgentRunService {
  private readonly repository: AgentRunRepository;
  private readonly toolSetBuilder: RunToolSetBuilder;
  private readonly ids: AgentRunServiceIds;
  private readonly clock: { now(): string };
  private readonly limits: AgentRunLoopLimits;
  private readonly traceLogger: AgentRunTraceLogger;
  private readonly activeRunAbortControllers = new Map<string, AbortController>();
  private readonly activeModelCallByRun = new Map<string, string>();
  private readonly approvalContinuations = new Map<string, RunApprovalContinuation>();

  constructor(private readonly options: CreateAgentRunServiceOptions) {
    if (!options.repository && !options.database) {
      throw new Error('Agent Run Service requires a repository or database.');
    }
    this.repository = options.repository ?? createAgentRunRepository({ database: options.database! });
    this.toolSetBuilder = createRunToolSetBuilder({ tool_registry_service: options.tool_registry_service });
    this.ids = {
      run_id: options.ids?.run_id ?? (() => `run:${crypto.randomUUID()}`),
      session_id: options.ids?.session_id ?? (() => `session:${crypto.randomUUID()}`),
      user_message_id: options.ids?.user_message_id ?? (() => `message:${crypto.randomUUID()}`),
      assistant_message_id: options.ids?.assistant_message_id ?? (() => `message:${crypto.randomUUID()}`),
      approval_request_id: options.ids?.approval_request_id ?? (() => `approval:${crypto.randomUUID()}`),
      event_id: options.ids?.event_id ?? (() => `event:${crypto.randomUUID()}`),
    };
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.limits = {
      max_model_calls: options.limits?.max_model_calls ?? 80,
      max_tool_rounds: options.limits?.max_tool_rounds ?? 50,
    };
    this.traceLogger = options.trace_logger ?? createNoopAgentRunTraceLogger();
    this.subscribeContextUsageSignals();
  }

  async startRun(request: StartRunRequest): Promise<StartRunResult> {
    const input = await this.options.input_service.processUserInput({ user_input: request.user_input });
    if (input.status === 'failed') {
      return failedStart(request, {
        code: 'input_failed',
        message: input.failure.message,
      });
    }

    const session = this.resolveSession(request);
    if (session.status === 'failed') {
      return { ...failedStart(request, session.failure), session_id: session.session_id };
    }

    const command = input.parsed_user_input.type === 'command'
      ? await this.options.command_service.handleCommandInput({
          raw_input: input.parsed_user_input.text,
          execution_context: this.resolveCommandExecutionContext(request, session.session_id),
        })
      : undefined;
    const commandRoute = this.routeCommandResult(request, session.session_id, command);
    if (commandRoute.type !== 'continue') {
      return commandRoute.result;
    }

    const runId = this.ids.run_id();
    const userMessageId = this.ids.user_message_id();
    const parsedInput = commandRoute.parsed_user_input ?? input.parsed_user_input;
    const userMessage = this.options.session_service.saveUserMessage({
      message_id: userMessageId,
      session_id: session.session_id,
      run_id: runId,
      content_text: textForRun(parsedInput, commandRoute.command_result),
      attachments: parsedInput.attachments,
      created_at: this.clock.now(),
    });
    if (userMessage.status === 'failed') {
      return {
        ...failedStart(request, {
          code: 'session_failed',
          message: userMessage.failure.message,
        }),
        session_id: session.session_id,
      };
    }

    const modelConfig = this.options.settings_service.resolveProviderRuntimeConfig({
      provider_id: request.model_selection.provider_id,
      model_id: request.model_selection.model_id,
    });
    if (modelConfig.status === 'failed') {
      return {
        ...failedStart(request, {
          code: 'model_call_failed',
          message: modelConfig.failure.message,
        }),
        session_id: session.session_id,
      };
    }
    const workspaceRoot = this.resolveWorkspaceRoot(request.workspace_id);
    if (workspaceRoot.status === 'failed') {
      return {
        ...failedStart(request, workspaceRoot.failure),
        session_id: session.session_id,
      };
    }

    let run = this.repository.createRun({
      run_id: runId,
      workspace_id: request.workspace_id,
      session_id: session.session_id,
      model_selection: request.model_selection,
      trigger: triggerForRun(userMessageId, commandRoute.command_result),
      status: 'queued',
      created_at: this.clock.now(),
    });
    run = this.repository.saveRun(transitionAgentRunStatus({
      run,
      to: 'running',
      changed_at: this.clock.now(),
    }));
    const queue = createAgentRunEventQueue((event) => this.options.event_publisher?.publish(event));
    const eventSink = this.createEventSink(queue, run);
    eventSink.emit('run.started', { run_id: run.run_id, session_id: run.session_id });
    this.traceLogger.record({
      trace_id: run.run_id,
      event_type: 'run.started',
      run_id: run.run_id,
      session_id: run.session_id,
      workspace_id: run.workspace_id,
      payload: {
        request_id: request.request_id,
        user_message_id: userMessageId,
        model_id: request.model_selection.model_id,
        provider_id: request.model_selection.provider_id,
        permission_mode: request.permission_mode ?? 'default',
        limits: this.limits,
      },
    });

    const controller = new AbortController();
    this.activeRunAbortControllers.set(run.run_id, controller);
    void this.executeRunLoop({
      queue,
      eventSink,
      run,
      user_message_id: userMessageId,
      model_config: modelConfig.config,
      permission_mode: request.permission_mode ?? 'default',
      ...(workspaceRoot.workspace_root ? { workspace_root: workspaceRoot.workspace_root } : {}),
      signal: controller.signal,
    });

    return {
      status: 'started',
      request_id: request.request_id,
      run,
      session_id: session.session_id,
      user_message_id: userMessageId,
      events: queue.events(),
    };
  }

  cancelRun(request: CancelRunRequest): CancelRunResult {
    const run = this.repository.getRun(request.run_id);
    if (!run) return { status: 'not_found', run_id: request.run_id };
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return { status: 'not_cancellable', run, reason: 'already_terminal' };
    }
    const queue = createAgentRunEventQueue((event) => this.options.event_publisher?.publish(event));
    const eventSink = this.createEventSink(queue, run);
    const cancelling = this.repository.saveRun(transitionAgentRunStatus({
      run,
      to: 'cancelling',
      changed_at: this.clock.now(),
    }));
    eventSink.emit('run.cancelling', { run_id: run.run_id, session_id: run.session_id });
    this.activeRunAbortControllers.get(run.run_id)?.abort();
    const activeModelCallId = this.activeModelCallByRun.get(run.run_id);
    if (activeModelCallId) {
      void this.options.model_call_service.cancelModelCall({ model_call_id: activeModelCallId });
      this.activeModelCallByRun.delete(run.run_id);
    }
    for (const approval of this.repository.listPendingApprovalRequestsByRun(run.run_id)) {
      this.repository.saveApprovalRequest({
        ...approval,
        status: 'cancelled',
        decided_at: this.clock.now(),
      });
    }
    const cancelled = this.repository.saveRun(transitionAgentRunStatus({
      run: cancelling,
      to: 'cancelled',
      changed_at: this.clock.now(),
    }));
    eventSink.emit('run.cancelled', { run_id: cancelled.run_id, session_id: cancelled.session_id });
    this.activeRunAbortControllers.delete(run.run_id);
    queue.close();
    return { status: 'cancelled', run: cancelled, events: queue.snapshot() };
  }

  async resumeRunAfterApproval(request: ResumeRunAfterApprovalRequest): Promise<ResumeRunAfterApprovalResult> {
    const approval = this.repository.getApprovalRequest(request.approval_request_id);
    if (!approval) return { status: 'not_found', approval_request_id: request.approval_request_id };
    const run = this.repository.getRun(approval.run_id);
    if (!run) {
      return {
        status: 'failed',
        failure: {
          code: 'approval_failed',
          message: `Run was not found for approval request: ${request.approval_request_id}`,
        },
      };
    }
    if (run.status !== 'waiting_for_approval') {
      return { status: 'not_waiting', run };
    }
    if (approval.status !== 'pending') {
      return {
        status: 'failed',
        failure: {
          code: 'approval_failed',
          message: `Approval request is not pending: ${request.approval_request_id}`,
        },
      };
    }

    const continuation = this.approvalContinuations.get(request.approval_request_id);
    if (!continuation) {
      return {
        status: 'failed',
        failure: {
          code: 'runtime_interrupted',
          message: 'Approval continuation is no longer available in this runtime.',
        },
      };
    }
    const originalPermissionDecision = continuation.original_approval_policy_by_approval_id[request.approval_request_id];
    if (!originalPermissionDecision) {
      return {
        status: 'failed',
        failure: {
          code: 'approval_failed',
          message: `Original permission decision was not found for approval request: ${request.approval_request_id}`,
        },
      };
    }

    const queue = createAgentRunEventQueue((event) => this.options.event_publisher?.publish(event));
    const eventSink = this.createEventSink(queue, run);
    const decision = {
      ...request.decision,
      decided_at: this.clock.now(),
    };

    const flow = await resumeApprovalFlow({
      run,
      approval_request: approval,
      pending_approval_requests_after_decision: this.repository.listPendingApprovalRequestsByRun(run.run_id),
      original_permission_decision: originalPermissionDecision,
      decision,
      session_id: run.session_id,
      permission_service: this.options.permission_service,
      decided_at: decision.decided_at,
    });
    if (flow.status === 'not_found') {
      return { status: 'not_found', approval_request_id: flow.approval_request_id };
    }
    if (flow.status === 'not_waiting') {
      return { status: 'not_waiting', run: flow.run };
    }
    if (flow.status === 'failed') {
      return { status: 'failed', failure: flow.failure, events: [] };
    }

    const decidedApproval = this.repository.saveApprovalRequest(flow.approval_request);
    const resumedRun = flow.run.status !== run.status
      ? this.repository.saveRun(flow.run)
      : flow.run;
    eventSink.emit('approval.resolved', {
      run_id: run.run_id,
      workspace_id: run.workspace_id,
      approval_request_id: decidedApproval.approval_request_id,
      decision: decision.decision,
    });

    let runtimeSources = continuation.runtime_sources;
    if (flow.status === 'denied') {
      runtimeSources = [...runtimeSources, runtimeSourceFromToolResult(flow.tool_result)];
      eventSink.emit('tool_call.denied', {
        run_id: resumedRun.run_id,
        workspace_id: resumedRun.workspace_id,
        tool_call_id: approval.subject.tool_call_id,
        tool_name: approval.subject.tool_name,
      });
    } else {
      const workspaceRoot = this.resolveWorkspaceRoot(run.workspace_id);
      if (workspaceRoot.status === 'failed') {
        return { status: 'failed', failure: workspaceRoot.failure, events: [] };
      }
      const toolResult = await this.resolveToolExecutionService({
        run_id: run.run_id,
        session_id: run.session_id,
        workspace_id: run.workspace_id,
        workspace_root: workspaceRoot.workspace_root,
      }).executeTool({
        toolName: approval.subject.tool_name,
        input: approval.subject.input,
      });
      const toolFact = toolResultRuntimeFactFromExecution({
        tool_call_id: approval.subject.tool_call_id,
        tool_name: approval.subject.tool_name,
        result: toolResult,
        created_at: this.clock.now(),
      });
      runtimeSources = [...runtimeSources, runtimeSourceFromToolResult(toolFact)];
      eventSink.emit('tool_result.created', {
        run_id: resumedRun.run_id,
        workspace_id: resumedRun.workspace_id,
        tool_call_id: toolFact.tool_call_id,
        tool_name: toolFact.tool_name,
        status: toolFact.status,
      });
      eventSink.emit(toolResult.type === 'succeeded' ? 'tool_call.completed' : 'tool_call.failed', {
        run_id: resumedRun.run_id,
        workspace_id: resumedRun.workspace_id,
        tool_call_id: approval.subject.tool_call_id,
        tool_name: approval.subject.tool_name,
      });
    }

    if (flow.continuation === 'waiting_for_other_approval') {
      this.approvalContinuations.delete(request.approval_request_id);
      const pendingApprovalIds = this.repository
        .listPendingApprovalRequestsByRun(run.run_id)
        .map((approvalRequest) => approvalRequest.approval_request_id);
      for (const pending of this.repository.listPendingApprovalRequestsByRun(run.run_id)) {
        this.approvalContinuations.set(pending.approval_request_id, {
          ...continuation,
          pending_approval_ids: pendingApprovalIds,
          original_approval_policy_by_approval_id: continuation.original_approval_policy_by_approval_id,
          run_id: resumedRun.run_id,
          user_message_id: continuation.user_message_id,
          model_config: continuation.model_config,
          permission_mode: continuation.permission_mode,
          runtime_sources: runtimeSources,
        });
      }
      queue.close();
      return { status: 'resumed', run: resumedRun, events: queue.events() };
    }

    for (const approvalId of continuation.pending_approval_ids) {
      this.approvalContinuations.delete(approvalId);
    }

    const deferred = await this.continueDeferredToolCallGroup({
      run: resumedRun,
      continuation,
      runtime_sources: runtimeSources,
      eventSink,
      signal: undefined,
    });
    runtimeSources = deferred.runtime_sources;
    if (deferred.status === 'waiting_for_approval') {
      queue.close();
      return { status: 'resumed', run: deferred.run, events: queue.events() };
    }
    if (deferred.status === 'failed') {
      queue.close();
      return { status: 'failed', failure: deferred.failure, events: [] };
    }

    const controller = new AbortController();
    this.activeRunAbortControllers.set(run.run_id, controller);
    void this.executeRunLoop({
      queue,
      eventSink,
      run: deferred.run,
      user_message_id: continuation.user_message_id,
      model_config: continuation.model_config,
      permission_mode: continuation.permission_mode,
      ...(continuation.workspace_root ? { workspace_root: continuation.workspace_root } : {}),
      initial_runtime_sources: runtimeSources,
      signal: controller.signal,
    });
    return { status: 'resumed', run: deferred.run, events: queue.events() };
  }

  cleanupInterruptedRuns(_request: CleanupInterruptedRunsRequest): CleanupInterruptedRunsResult {
    const queue = createAgentRunEventQueue((event) => this.options.event_publisher?.publish(event));
    const result = cleanupInterruptedRunsCore({
      repository: this.repository,
      cleaned_at: this.clock.now(),
    });
    for (const runId of result.cleaned_run_ids) {
      this.activeRunAbortControllers.get(runId)?.abort();
      this.activeRunAbortControllers.delete(runId);
      this.activeModelCallByRun.delete(runId);
      for (const [approvalId, continuation] of this.approvalContinuations.entries()) {
        if (continuation.run_id === runId) {
          this.approvalContinuations.delete(approvalId);
        }
      }
      queue.emit({
        event_id: this.ids.event_id(),
        type: 'run.cleaned_interrupted',
        run_id: runId,
        created_at: this.clock.now(),
        payload: { reason: _request.reason },
      });
    }
    queue.close();
    return { status: 'completed', cleaned_run_ids: result.cleaned_run_ids, events: queue.snapshot() };
  }

  private createEventSink(
    queue: AgentRunEventQueue,
    run?: Pick<AgentRun, 'run_id' | 'session_id'>,
  ): { emit(type: string, payload?: Record<string, unknown>): AgentRunEvent } {
    return {
      emit: (type: string, payload?: Record<string, unknown>) => {
        const event: AgentRunEvent = {
          event_id: this.ids.event_id(),
          type,
          created_at: this.clock.now(),
          ...(payload?.run_id && typeof payload.run_id === 'string'
            ? { run_id: payload.run_id }
            : run?.run_id ? { run_id: run.run_id } : {}),
          ...(payload?.session_id && typeof payload.session_id === 'string'
            ? { session_id: payload.session_id }
            : run?.session_id ? { session_id: run.session_id } : {}),
          ...(payload ? { payload } : {}),
        };
        queue.emit(event);
        return event;
      },
    };
  }

  private subscribeContextUsageSignals(): void {
    if (!this.options.context_usage_signal_bus || !this.options.context_compaction_service) {
      return;
    }

    this.options.context_usage_signal_bus.subscribe('auto_compaction_needed', async (signal) => {
      if (signal.kind !== 'auto_compaction_needed') {
        return;
      }
      this.options.context_usage_monitor?.markCompactionRunning({
        session_id: signal.session_id,
        ...(signal.workspace_id ? { workspace_id: signal.workspace_id } : {}),
        running: true,
      });
      try {
        await consumeContextUsageSignal({
          signal,
          context_compaction_service: this.options.context_compaction_service!,
          event_sink: {
            emit: (type, payload) => {
              const event: AgentRunEvent = {
                event_id: this.ids.event_id(),
                type,
                created_at: this.clock.now(),
                ...(signal.session_id ? { session_id: signal.session_id } : {}),
                ...(payload ? { payload } : {}),
              };
              this.options.event_publisher?.publish(event);
              return event;
            },
          },
        });
      } finally {
        this.options.context_usage_monitor?.markCompactionRunning({
          session_id: signal.session_id,
          ...(signal.workspace_id ? { workspace_id: signal.workspace_id } : {}),
          running: false,
        });
      }
    });
  }

  private async continueDeferredToolCallGroup(input: {
    run: AgentRun;
    continuation: RunApprovalContinuation;
    runtime_sources: SessionContextSource[];
    eventSink: { emit(type: string, payload?: Record<string, unknown>): AgentRunEvent };
    signal?: AbortSignal;
  }): Promise<
    | { status: 'ready'; run: AgentRun; runtime_sources: SessionContextSource[] }
    | { status: 'waiting_for_approval'; run: AgentRun; runtime_sources: SessionContextSource[] }
    | { status: 'failed'; failure: AgentRunFailure; runtime_sources: SessionContextSource[] }
  > {
    if (input.continuation.deferred_tool_calls.length === 0) {
      return { status: 'ready', run: input.run, runtime_sources: input.runtime_sources };
    }

    const permissionSettings = this.options.settings_service.resolvePermissionSettings({
      workspace_id: input.run.workspace_id,
      session_id: input.run.session_id,
    });
    if (permissionSettings.status === 'failed') {
      return {
        status: 'failed',
        runtime_sources: input.runtime_sources,
        failure: {
          code: 'approval_failed',
          message: permissionSettings.failure.message,
        },
      };
    }

    const toolSet = this.toolSetBuilder.getToolSet({ run_id: input.run.run_id });
    const registeredTools = new Map(
      toolSet.items.flatMap((item) => {
        const tool = this.toolSetBuilder.getRegisteredTool(input.run.run_id, item.name);
        return tool ? [[item.name, tool] as const] : [];
      }),
    );
    const toolGroup = await orchestrateToolCallGroup({
      run_id: input.run.run_id,
      workspace_id: input.run.workspace_id,
      ...(input.continuation.workspace_root ? { workspace_root: input.continuation.workspace_root } : {}),
      permission_mode: input.continuation.permission_mode,
      permission_settings: permissionSettings.permission_settings,
      runtime_capability_policy: {
        custom_tools_enabled: true,
        process_execution_enabled: true,
        network_enabled: true,
      },
      tool_set: toolSet,
      tool_calls: input.continuation.deferred_tool_calls,
      registered_tools_by_name: registeredTools,
      permission_service: this.options.permission_service,
      tool_execution_service: this.resolveToolExecutionService({
        run_id: input.run.run_id,
        session_id: input.run.session_id,
        workspace_id: input.run.workspace_id,
        ...(input.continuation.workspace_root ? { workspace_root: input.continuation.workspace_root } : {}),
      }),
      trace_logger: this.traceLogger,
      ...(this.options.workspace_path_policy_service ? { workspace_path_policy_service: this.options.workspace_path_policy_service } : {}),
      clock: this.clock,
      ids: { approval_request_id: this.ids.approval_request_id },
      ...(input.signal ? { signal: input.signal } : {}),
    });

    let runtimeSources = input.runtime_sources;
    for (const toolCall of toolGroup.tool_calls) {
      input.eventSink.emit(`tool_call.${toolCall.status}`, {
        run_id: input.run.run_id,
        workspace_id: input.run.workspace_id,
        tool_call_id: toolCall.tool_call_id,
        tool_name: toolCall.tool_name,
      });
    }
    for (const toolResult of toolGroup.tool_result_facts) {
      input.eventSink.emit('tool_result.created', {
        run_id: input.run.run_id,
        workspace_id: input.run.workspace_id,
        tool_call_id: toolResult.tool_call_id,
        tool_name: toolResult.tool_name,
        status: toolResult.status,
      });
      runtimeSources = [...runtimeSources, runtimeSourceFromToolResult(toolResult)];
    }

    if (toolGroup.pending_approvals.length > 0) {
      for (const pendingApproval of toolGroup.pending_approvals) {
        this.repository.createApprovalRequest(pendingApproval.approval_request);
        input.eventSink.emit('approval.requested', {
          run_id: input.run.run_id,
          workspace_id: input.run.workspace_id,
          approval_request_id: pendingApproval.approval_request.approval_request_id,
        });
      }
      const waitingRun = this.repository.saveRun(transitionAgentRunStatus({
        run: input.run,
        to: 'waiting_for_approval',
        changed_at: this.clock.now(),
      }));
      const nextContinuation: RunApprovalContinuation = {
        ...input.continuation,
        run_id: waitingRun.run_id,
        pending_approval_ids: toolGroup.pending_approvals.map((approval) => approval.approval_request.approval_request_id),
        original_approval_policy_by_approval_id: Object.fromEntries(
          toolGroup.pending_approvals.map((approval) => [
            approval.approval_request.approval_request_id,
            approval.permission_decision,
          ]),
        ),
        deferred_tool_calls: toolGroup.deferred_tool_calls,
        runtime_sources: runtimeSources,
      };
      for (const approvalId of nextContinuation.pending_approval_ids) {
        this.approvalContinuations.set(approvalId, nextContinuation);
      }
      return { status: 'waiting_for_approval', run: waitingRun, runtime_sources: runtimeSources };
    }

    input.eventSink.emit('tool_result_facts.submitted', {
      run_id: input.run.run_id,
      workspace_id: input.run.workspace_id,
      count: toolGroup.tool_result_facts.length,
    });
    return { status: 'ready', run: input.run, runtime_sources: runtimeSources };
  }

  private async executeRunLoop(input: {
    queue: AgentRunEventQueue;
    eventSink: { emit(type: string, payload?: Record<string, unknown>): AgentRunEvent };
    run: AgentRun;
    user_message_id: string;
    model_config: ModelCallConfig;
    permission_mode: PermissionMode;
    workspace_root?: string;
    initial_runtime_sources?: SessionContextSource[];
    signal: AbortSignal;
  }): Promise<void> {
    try {
      const result = await runAgentModelToolLoop({
        repository: this.repository,
        session_service: this.options.session_service,
        settings_service: this.options.settings_service,
        context_service: this.options.context_service,
        model_call_service: this.options.model_call_service,
        tool_set_builder: this.toolSetBuilder,
        tool_execution_service: this.resolveToolExecutionService({
          run_id: input.run.run_id,
          session_id: input.run.session_id,
          workspace_id: input.run.workspace_id,
          ...(input.workspace_root ? { workspace_root: input.workspace_root } : {}),
        }),
        permission_service: this.options.permission_service,
        trace_logger: this.traceLogger,
        ...(this.options.workspace_path_policy_service ? { workspace_path_policy_service: this.options.workspace_path_policy_service } : {}),
        ...(this.options.memory_service ? { memory_service: this.options.memory_service } : {}),
        event_sink: input.eventSink,
        on_model_call_started: ({ run_id, model_call_id }) => {
          this.activeModelCallByRun.set(run_id, model_call_id);
        },
        ids: {
          assistant_message_id: this.ids.assistant_message_id,
          approval_request_id: this.ids.approval_request_id,
        },
        clock: this.clock,
        limits: this.limits,
      }, {
        run: input.run,
        user_message_id: input.user_message_id,
        model_config: input.model_config,
        permission_mode: input.permission_mode,
        ...(input.workspace_root ? { workspace_root: input.workspace_root } : {}),
        ...(input.initial_runtime_sources ? { initial_runtime_sources: input.initial_runtime_sources } : {}),
        signal: input.signal,
      });

      this.activeModelCallByRun.delete(input.run.run_id);
      if (result.status === 'waiting_for_approval') {
        for (const approvalId of result.continuation.pending_approval_ids) {
          this.approvalContinuations.set(approvalId, result.continuation);
        }
        return;
      }
      this.activeRunAbortControllers.delete(input.run.run_id);
    } catch (error) {
      const latest = this.repository.getRun(input.run.run_id) ?? input.run;
      if (latest.status !== 'completed' && latest.status !== 'failed' && latest.status !== 'cancelled') {
        this.repository.saveRun(transitionAgentRunStatus({
          run: latest,
          to: 'failed',
          changed_at: this.clock.now(),
          failure: {
            code: 'internal_error',
            message: error instanceof Error ? error.message : 'Agent Run failed unexpectedly.',
          },
        }));
      }
      input.eventSink.emit('run.failed', {
        run_id: input.run.run_id,
        session_id: input.run.session_id,
        workspace_id: input.run.workspace_id,
        failure: {
          code: 'internal_error',
          message: error instanceof Error ? error.message : 'Agent Run failed unexpectedly.',
        },
      });
      this.traceLogger.record({
        trace_id: input.run.run_id,
        event_type: 'run.failed',
        run_id: input.run.run_id,
        session_id: input.run.session_id,
        workspace_id: input.run.workspace_id,
        payload: {
          failure: {
            code: 'internal_error',
            message: error instanceof Error ? error.message : 'Agent Run failed unexpectedly.',
          },
        },
      });
    } finally {
      queueMicrotask(() => input.queue.close());
    }
  }

  private resolveSession(request: StartRunRequest):
    | { status: 'ok'; session_id: string }
    | { status: 'failed'; session_id?: string; failure: AgentRunFailure } {
    if (request.session.type === 'existing') {
      const existing = this.options.session_service.getSession({ session_id: request.session.session_id });
      if (existing.status === 'found') return { status: 'ok', session_id: existing.session.session_id };
      return {
        status: 'failed',
        session_id: request.session.session_id,
        failure: {
          code: 'session_failed',
          message: existing.status === 'failed' ? existing.failure.message : 'Session was not found.',
        },
      };
    }

    const sessionId = this.ids.session_id();
    const created = this.options.session_service.createSession({
      session_id: sessionId,
      workspace_id: request.workspace_id,
      title: request.session.title ?? 'New session',
      created_at: this.clock.now(),
    });
    if (created.status === 'created') return { status: 'ok', session_id: created.session.session_id };
    return {
      status: 'failed',
      session_id: sessionId,
      failure: { code: 'session_failed', message: created.failure.message },
    };
  }

  private resolveCommandExecutionContext(
    request: StartRunRequest,
    sessionId: string,
  ): CommandExecutionContext {
    return this.options.command_execution_context_provider?.({
      request,
      session_id: sessionId,
    }) ?? {
      session_id: sessionId,
      workspace_id: request.workspace_id,
    };
  }

  private resolveWorkspaceRoot(workspaceId: string):
    | { status: 'ok'; workspace_root?: string }
    | { status: 'failed'; failure: AgentRunFailure } {
    if (!this.options.workspace_service) {
      return { status: 'ok' };
    }
    const workspace = this.options.workspace_service.getWorkspace({ workspace_id: workspaceId });
    if (workspace.status === 'found') {
      return { status: 'ok', workspace_root: workspace.workspace.root_path };
    }
    return {
      status: 'failed',
      failure: {
        code: 'session_failed',
        message: `Workspace ${workspaceId} was not found.`,
      },
    };
  }

  private resolveToolExecutionService(input: {
    run_id: string;
    session_id: string;
    workspace_id: string;
    workspace_root?: string;
  }): Pick<ToolExecutionService, 'executeTool'> {
    if (this.options.tool_execution_service_factory) {
      return this.options.tool_execution_service_factory(input);
    }
    if (this.options.tool_execution_service) {
      return this.options.tool_execution_service;
    }
    return {
      async executeTool(request) {
        return {
          type: 'failed',
          toolName: request.toolName,
          error: {
            code: 'tool_execution_failed',
            message: 'Tool Execution Service is not configured.',
          },
          normalizedResult: {
            kind: 'error',
            content: 'Tool Execution Service is not configured.',
            isError: true,
            truncated: false,
          },
        };
      },
    };
  }

  private routeCommandResult(
    request: StartRunRequest,
    sessionId: string,
    command: CommandExecutionResult | undefined,
  ):
    | { type: 'continue'; command_result?: CommandExecutionResult; parsed_user_input?: ParsedUserInput }
    | { type: 'return'; result: StartRunResult } {
    if (!command || command.type === 'not_command') {
      return { type: 'continue' };
    }
    if (command.type === 'host_interaction_request') {
      return {
        type: 'return',
        result: {
          status: 'host_interaction_required',
          request_id: request.request_id,
          session_id: sessionId,
          interaction: command.request,
        },
      };
    }
    if (command.type === 'completed') {
      return {
        type: 'return',
        result: {
          status: 'completed',
          request_id: request.request_id,
          session_id: sessionId,
          ...(command.message ? { message: command.message } : {}),
        },
      };
    }
    if (command.type === 'error') {
      return {
        type: 'return',
        result: {
          status: 'failed',
          request_id: request.request_id,
          session_id: sessionId,
          failure: {
            code: 'command_failed',
            message: command.message,
          },
        },
      };
    }
    return {
      type: 'continue',
      command_result: command,
    };
  }
}

function triggerForRun(
  userMessageId: string,
  command: CommandExecutionResult | undefined,
): AgentRun['trigger'] {
  if (command?.type === 'agent_run') {
    return {
      type: 'command',
      command_name: command.input.command.name,
      user_message_id: userMessageId,
    };
  }
  return { type: 'user_input', user_message_id: userMessageId };
}

function textForRun(
  parsedInput: ParsedUserInput,
  command: CommandExecutionResult | undefined,
): string {
  if (command?.type === 'agent_run') {
    return command.input.raw_input;
  }
  return parsedInput.text;
}

type AgentRunEventQueue = {
  emit(event: AgentRunEvent): void;
  close(): void;
  snapshot(): AgentRunEvent[];
  events(): AsyncIterable<AgentRunEvent>;
};

function createAgentRunEventQueue(
  publish: (event: AgentRunEvent) => void,
): AgentRunEventQueue {
  const events: AgentRunEvent[] = [];
  const waiters: Array<() => void> = [];
  let closed = false;

  return {
    emit(event) {
      if (closed) {
        return;
      }
      events.push(event);
      publish(event);
      waiters.splice(0).forEach((resolve) => resolve());
    },

    close() {
      closed = true;
      waiters.splice(0).forEach((resolve) => resolve());
    },

    snapshot() {
      return [...events];
    },

    async *events() {
      let index = 0;
      while (!closed || index < events.length) {
        if (index < events.length) {
          yield events[index]!;
          index += 1;
          continue;
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
  };
}

function runtimeSourceFromToolResult(toolResult: ToolResultRuntimeFact): SessionContextSource {
  return {
    source_id: `tool-result:${toolResult.tool_call_id}:${toolResult.created_at}`,
    source_kind: 'tool_result',
    text: [
      `tool_name: ${toolResult.tool_name}`,
      `status: ${toolResult.status}`,
      toolResult.content ? `content: ${toolResult.content}` : undefined,
      toolResult.observation ? `observation: ${JSON.stringify(toolResult.observation)}` : undefined,
    ].filter(Boolean).join('\n'),
    persisted: false,
    created_at: toolResult.created_at,
    metadata: {
      origin_module: 'agent-run',
      tool_call_id: toolResult.tool_call_id,
      tool_name: toolResult.tool_name,
      status: toolResult.status,
    },
  };
}

function toolResultRuntimeFactFromExecution(input: {
  tool_call_id: string;
  tool_name: string;
  result: Awaited<ReturnType<Pick<ToolExecutionService, 'executeTool'>['executeTool']>>;
  created_at: string;
}): ToolResultRuntimeFact {
  return {
    tool_call_id: input.tool_call_id,
    tool_name: input.result.toolName ?? input.tool_name,
    status: input.result.type === 'succeeded' ? 'completed' : 'failed',
    content: input.result.normalizedResult.content,
    ...(input.result.toolExecutionObservation ? { observation: input.result.toolExecutionObservation } : {}),
    created_at: input.created_at,
  };
}

function failedStart(request: StartRunRequest, failure: AgentRunFailure): Extract<StartRunResult, { status: 'failed' }> {
  return {
    status: 'failed',
    request_id: request.request_id,
    failure,
  };
}
