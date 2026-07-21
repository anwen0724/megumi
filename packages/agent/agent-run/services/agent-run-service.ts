/*
 * Public Agent Run Service factory.
 * It owns user-input-to-run orchestration and delegates model/tool looping to core.
 */
import type { CommandExecutionContext, CommandExecutionResult } from '../../commands';
import type { InputService, ParsedUserInput } from '../../input';
import type { PermissionMode, PermissionService } from '../../permissions';
import type {
  Session,
  SessionBranchService,
  SessionEntry,
  SessionMessageWithAttachments,
  SessionService,
} from '../../session';
import type { SettingsService } from '../../settings';
import type { SkillCatalogItem, SkillSelection, UsedSkillContent, SkillService } from '@megumi/skills';
import type { ToolExecutionService, ToolRegistryService } from '../../tools';
import type { WorkspacePathPolicyService, WorkspaceService } from '../../workspace';
import type {
  ContextCapacity,
  CurrentConversationRun,
} from '../../context';
import type { RuntimeError, RuntimeEvent } from '../../events';
import type {
  AgentRun,
  AgentRunApprovalRequest,
  AgentRunFailure,
  ToolCallStep,
  AgentRunService,
  CancelRunRequest,
  CancelRunResult,
  ResumeRunAfterApprovalRequest,
  ResumeRunAfterApprovalResult,
  StartRunRequest,
  StartRunResult,
} from '../contracts/agent-run-contracts';
import type { AgentRunTraceLogger } from '../contracts/agent-run-trace-contracts';
import type {
  ModelCallConfig,
  ModelCallService,
  ToolResultRuntimeFact,
} from '../contracts/model-call-contracts';
import {
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
import { resumeApprovalFlow } from '../core/approval-flow';
import {
  createAgentRunRuntimeEvent,
  type AgentRunRuntimeEventFactory,
} from '../core/agent-run-runtime-events';
import { ActiveRunStore } from '../core/active-run-store';
import { assistantReplyReasonForFailure, commitTerminalReply } from '../core/terminal-reply';
import { mapToolExecutionResultToRuntimeFact } from '../core/tool-result-mapper';
import { createNoopAgentRunTraceLogger } from './agent-run-trace-logger';
import type { ObservabilityService, SpanHandle, TraceHandle } from '@megumi/observability';

export type CreateAgentRunServiceOptions = {
  active_run_store?: ActiveRunStore;
  input_service: Pick<InputService, 'processUserInput'>;
  command_service: {
    handleCommandInput(request: { raw_input: string; execution_context?: CommandExecutionContext }): Promise<CommandExecutionResult>;
  };
  command_execution_context_provider?: (input: {
    request: StartRunRequest;
    session_id: string;
  }) => CommandExecutionContext | undefined;
  session_service: Pick<SessionService,
    'createSession' | 'getSession' | 'saveUserMessage'
    | 'saveModelResponse' | 'saveAssistantReply' | 'saveToolResultMessage'>;
  branch_service?: Pick<SessionBranchService, 'consumeBranchDraft'>;
  settings_service: Pick<SettingsService, 'resolveProviderRuntimeConfig' | 'resolvePermissionSettings'>;
  context_service: Parameters<typeof runAgentModelToolLoop>[0]['context_service'];
  model_context_provider(selection: { providerId: string; modelId: string }): ContextCapacity;
  model_call_service: ModelCallService;
  skill_service_factory?: (input: { workspace_root?: string }) => SkillService;
  tool_registry_service: Pick<ToolRegistryService, 'listAvailableTools'>;
  tool_execution_service?: Pick<ToolExecutionService, 'executeTool'>;
  tool_execution_service_factory?: (input: {
    run_id: string;
    session_id: string;
    workspace_id: string;
    workspace_root?: string;
    skill_service?: SkillService;
  }) => Pick<ToolExecutionService, 'executeTool'>;
  permission_service: Pick<PermissionService, 'evaluateToolCall' | 'applyApprovalDecision'>;
  workspace_service?: Pick<WorkspaceService, 'getWorkspace'>;
  workspace_path_policy_service?: Pick<WorkspacePathPolicyService, 'classifyPath'>;
  memory_service?: Parameters<typeof runAgentModelToolLoop>[0]['memory_service'];
  event_publisher?: {
    publish(event: RuntimeEvent): RuntimeEvent | void;
  };
  trace_logger?: AgentRunTraceLogger;
  observability?: ObservabilityService;
  ids?: Partial<AgentRunServiceIds>;
  clock?: { now(): string };
  limits?: Partial<AgentRunLoopLimits>;
};

type AgentRunServiceIds = {
  run_id(): string;
  user_message_id(): string;
  assistant_message_id(): string;
  tool_result_message_id(): string;
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
  private readonly activeRuns: ActiveRunStore;
  private readonly toolsBuilder: RunToolSetBuilder;
  private readonly ids: AgentRunServiceIds;
  private readonly clock: { now(): string };
  private readonly limits: AgentRunLoopLimits;
  private readonly traceLogger: AgentRunTraceLogger;
  private readonly activeRunAbortControllers = new Map<string, AbortController>();
  private readonly activeModelCallByRun = new Map<string, string>();
  private readonly approvalContinuations = new Map<string, RunApprovalContinuation>();
  private readonly observabilityRuns = new Map<string, { trace: TraceHandle; root: SpanHandle }>();
  private readonly approvalWaitSpans = new Map<string, { runId: string; span: SpanHandle }>();
  private readonly skillServicesByRun = new Map<string, SkillService>();

  constructor(private readonly options: CreateAgentRunServiceOptions) {
    this.activeRuns = options.active_run_store ?? new ActiveRunStore();
    this.toolsBuilder = createRunToolSetBuilder({ tool_registry_service: options.tool_registry_service });
    this.ids = {
      run_id: options.ids?.run_id ?? (() => `run:${crypto.randomUUID()}`),
      user_message_id: options.ids?.user_message_id ?? (() => `message:${crypto.randomUUID()}`),
      assistant_message_id: options.ids?.assistant_message_id ?? (() => `message:${crypto.randomUUID()}`),
      tool_result_message_id: options.ids?.tool_result_message_id ?? (() => `message:${crypto.randomUUID()}`),
      approval_request_id: options.ids?.approval_request_id ?? (() => `approval:${crypto.randomUUID()}`),
      event_id: options.ids?.event_id ?? (() => `event:${crypto.randomUUID()}`),
    };
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.limits = {
      max_model_calls: options.limits?.max_model_calls ?? 80,
      max_tool_rounds: options.limits?.max_tool_rounds ?? 50,
    };
    this.traceLogger = options.trace_logger ?? createNoopAgentRunTraceLogger();
  }

  async startRun(request: StartRunRequest): Promise<StartRunResult> {
    const input = await this.options.input_service.processUserInput({ user_input: request.user_input });
    if (input.status === 'failed') {
      return failedStart(request, {
        code: 'input_failed',
        message: input.failure.message,
      });
    }

    const resolvedSession = this.resolveSession(request);
    if (resolvedSession.status === 'failed') {
      return {
        ...failedStart(request, resolvedSession.failure),
        ...(resolvedSession.session ? { session: resolvedSession.session } : {}),
      };
    }
    const session = resolvedSession.session;
    const sessionId = session.session_id;

    const command = input.parsed_user_input.type === 'command'
      ? await this.options.command_service.handleCommandInput({
          raw_input: input.parsed_user_input.text,
          execution_context: this.resolveCommandExecutionContext(request, sessionId),
        })
      : undefined;
    const commandRoute = this.routeCommandResult(request, session, command);
    if (commandRoute.type !== 'continue') {
      return commandRoute.result;
    }

    const runId = this.ids.run_id();
    const userMessageId = this.ids.user_message_id();
    const parsedInput = commandRoute.parsed_user_input ?? input.parsed_user_input;
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
        session,
      };
    }
    const branchParent = this.consumeBranchDraftForRun(request, session);
    if (branchParent.status === 'failed') {
      return {
        ...failedStart(request, branchParent.failure),
        session,
      };
    }
    const workspaceRoot = this.resolveWorkspaceRoot(request.workspace_id);
    if (workspaceRoot.status === 'failed') {
      return {
        ...failedStart(request, workspaceRoot.failure),
        session,
      };
    }
    const skillService = this.options.skill_service_factory?.({
      ...(workspaceRoot.workspace_root ? { workspace_root: workspaceRoot.workspace_root } : {}),
    });
    const skillCatalogResult = skillService ? await skillService.getSkillCatalog({}) : { status: 'ok' as const, skills: [] };
    if (skillCatalogResult.status === 'failed') {
      return { ...failedStart(request, { code: 'context_failed', message: skillCatalogResult.message }), session };
    }
    const userMessage = await this.options.session_service.saveUserMessage({
      message_id: userMessageId,
      session_id: sessionId,
      run_id: runId,
      content: [{ type: 'text', text: textForRun(parsedInput, commandRoute.command_result) }],
      attachments: parsedInput.attachments.map((image) => ({
        name: image.name,
        media_type: image.media_type,
        byte_length: image.byte_length,
        bytes: image.bytes,
      })),
      ...(branchParent.parent_entry_id ? { parent_entry_id: branchParent.parent_entry_id } : {}),
      created_at: this.clock.now(),
    });
    if (userMessage.status === 'failed') {
      return {
        ...failedStart(request, {
          code: 'session_failed',
          message: userMessage.failure.message,
        }),
        session,
      };
    }

    let run = this.activeRuns.createRun({
      run_id: runId,
      workspace_id: request.workspace_id,
      session_id: sessionId,
      model_selection: request.model_selection,
      trigger: triggerForRun(userMessageId, commandRoute.command_result),
      status: 'queued',
      created_at: this.clock.now(),
    });
    run = this.activeRuns.saveRun(transitionAgentRunStatus({
      run,
      to: 'running',
      changed_at: this.clock.now(),
    }));
    this.activeRuns.initializeExecution(run.run_id, userMessage.entry.entry_id);
    if (skillService) this.skillServicesByRun.set(run.run_id, skillService);
    const queue = createAgentRunEventQueue((event) => this.options.event_publisher?.publish(event));
    const eventSink = this.createEventSink(queue, run);
    const commandSkills = await this.resolveCommandSkills({
      requested_skill: request.skill_selection
        ?? (commandRoute.command_result?.type === 'agent_run'
          ? commandRoute.command_result.input.requestedSkill
          : undefined),
      skill_service: skillService,
    });
    if (commandSkills.status === 'failed') {
      const terminalReply = commitTerminalReply({
        dependencies: {
          active_run_store: this.activeRuns,
          session_service: this.options.session_service,
          ids: this.ids,
          clock: this.clock,
        },
        run,
        status: 'failed',
        reason_code: 'internal_error',
      });
      const failure = terminalReply.status === 'failed'
        ? { code: 'session_failed' as const, message: terminalReply.message }
        : commandSkills.failure;
      const failedRun = this.activeRuns.saveRun(transitionAgentRunStatus({
        run,
        to: 'failed',
        changed_at: this.clock.now(),
        failure,
      }));
      if (terminalReply.status === 'committed') {
        eventSink.emit({
          eventType: 'run.failed',
          run: failedRun,
          messageId: terminalReply.message_id,
          payload: {
            error: agentRunFailureToRuntimeError(failure),
          },
        });
      }
      queue.close();
      this.activeRuns.release(run.run_id);
      this.skillServicesByRun.delete(run.run_id);
      return {
        status: 'failed',
        request_id: request.request_id,
        session,
        failure,
        events: queue.snapshot(),
      };
    }
    const controller = new AbortController();
    this.activeRunAbortControllers.set(run.run_id, controller);
    setTimeout(() => {
      if (controller.signal.aborted) {
        queue.close();
        return;
      }
      eventSink.emit({
        eventType: 'run.started',
        run,
        payload: {
          runKind: 'agent',
          providerId: request.model_selection.provider_id,
          modelId: request.model_selection.model_id,
        },
      });
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
          permission_mode: request.permission_mode ?? 'ask',
          limits: this.limits,
        },
      });
      const diagnostic = this.startRunObservability(run, request.request_id);
      const execute = () => this.executeRunLoop({
        queue,
        eventSink,
        run,
        current_run: currentRunFromSavedUserMessage(run.run_id, userMessage.message, userMessage.entry),
        skill_catalog: skillCatalogResult.skills,
        used_skills: commandSkills.used_skills,
        ...(skillService ? { skill_service: skillService } : {}),
        model_context: this.options.model_context_provider({
          providerId: request.model_selection.provider_id,
          modelId: request.model_selection.model_id,
        }),
        model_config: modelConfig.config,
        permission_mode: request.permission_mode ?? 'ask',
        ...(workspaceRoot.workspace_root ? { workspace_root: workspaceRoot.workspace_root } : {}),
        signal: controller.signal,
      });
      void (diagnostic ? this.options.observability!.runInSpanContext(diagnostic.root, execute) : execute());
    }, 0);

    return {
      status: 'started',
      request_id: request.request_id,
      run,
      session,
      user_message_id: userMessageId,
      user_message: userMessage.message,
      events: queue.events(),
    };
  }

  cancelRun(request: CancelRunRequest): CancelRunResult {
    const run = this.activeRuns.getRun(request.run_id);
    if (!run) return { status: 'not_found', run_id: request.run_id };
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return { status: 'not_cancellable', run, reason: 'already_terminal' };
    }
    const queue = createAgentRunEventQueue((event) => this.options.event_publisher?.publish(event));
    const wasWaitingForApproval = run.status === 'waiting_for_approval';
    const eventSink = this.createEventSink(queue, run);
    const cancelling = this.activeRuns.saveRun(transitionAgentRunStatus({
      run,
      to: 'cancelling',
      changed_at: this.clock.now(),
    }));
    eventSink.emit({
      eventType: 'run.cancelling',
      run,
      payload: {
        cancelRequestId: `cancel:${run.run_id}`,
      },
    });
    this.activeRunAbortControllers.get(run.run_id)?.abort();
    const activeModelCallId = this.activeModelCallByRun.get(run.run_id);
    if (activeModelCallId) {
      void this.options.model_call_service.cancelModelCall({ model_call_id: activeModelCallId });
      this.activeModelCallByRun.delete(run.run_id);
    }
    for (const approval of this.activeRuns.listPendingApprovalRequestsByRun(run.run_id)) {
      const waiting = this.approvalWaitSpans.get(approval.approval_request_id);
      if (waiting && this.options.observability) {
        this.options.observability.endSpan({ span: waiting.span, status: 'cancelled' });
        this.approvalWaitSpans.delete(approval.approval_request_id);
      }
      this.activeRuns.saveApprovalRequest({
        ...approval,
        status: 'cancelled',
        decided_at: this.clock.now(),
      });
    }
    for (const step of this.activeRuns.listSteps(run.run_id)) {
      if (step.status === 'completed' || step.status === 'failed' || step.status === 'cancelled'
        || (step.type === 'tool_call' && step.status === 'denied')) {
        continue;
      }
      this.activeRuns.saveStep({
        ...step,
        status: 'cancelled',
        completed_at: this.clock.now(),
      });
    }
    const terminalReply = commitTerminalReply({
      dependencies: {
        active_run_store: this.activeRuns,
        session_service: this.options.session_service,
        ids: this.ids,
        clock: this.clock,
      },
      run,
      status: 'cancelled',
      reason_code: 'user_cancelled',
    });
    if (terminalReply.status === 'failed') {
      const failure: AgentRunFailure = {
        code: 'session_failed',
        message: terminalReply.message,
      };
      const failed = this.activeRuns.saveRun(transitionAgentRunStatus({
        run: cancelling,
        to: 'failed',
        changed_at: this.clock.now(),
        failure,
      }));
      this.endRunObservability(run.run_id, 'error');
      queue.close();
      if (wasWaitingForApproval) {
        this.activeRunAbortControllers.delete(run.run_id);
        this.activeRuns.release(run.run_id);
        this.skillServicesByRun.delete(run.run_id);
      }
      return { status: 'failed', failure, events: queue.snapshot() };
    }
    const cancelled = this.activeRuns.saveRun(transitionAgentRunStatus({
      run: cancelling,
      to: 'cancelled',
      changed_at: this.clock.now(),
    }));
    this.endRunObservability(run.run_id, 'cancelled');
    eventSink.emit({
      eventType: 'run.cancelled',
      run: cancelled,
      messageId: terminalReply.message_id,
      payload: {
        reason: 'user_cancelled',
      },
    });
    queue.close();
    const events = queue.snapshot();
    for (const [approvalId, continuation] of this.approvalContinuations) {
      if (continuation.run_id === run.run_id) this.approvalContinuations.delete(approvalId);
    }
    if (wasWaitingForApproval) {
      this.activeRunAbortControllers.delete(run.run_id);
      this.activeRuns.release(run.run_id);
      this.skillServicesByRun.delete(run.run_id);
    }
    return { status: 'cancelled', run: cancelled, events };
  }

  async resumeRunAfterApproval(request: ResumeRunAfterApprovalRequest): Promise<ResumeRunAfterApprovalResult> {
    const approval = this.activeRuns.getApprovalRequest(request.approval_request_id);
    if (!approval) return { status: 'not_found', approval_request_id: request.approval_request_id };
    const run = this.activeRuns.getRun(approval.run_id);
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
    const waitingSpan = this.approvalWaitSpans.get(request.approval_request_id);
    if (waitingSpan && this.options.observability) {
      this.options.observability.endSpan({ span: waitingSpan.span, status: 'ok', attributes: { decision: request.decision.decision } });
      this.approvalWaitSpans.delete(request.approval_request_id);
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

    const claim = this.activeRuns.claimApprovalRequest(request.approval_request_id);
    if (claim !== 'claimed') {
      return claim === 'not_found'
        ? { status: 'not_found', approval_request_id: request.approval_request_id }
        : {
            status: 'failed',
            failure: {
              code: 'approval_failed',
              message: claim === 'already_claimed'
                ? 'Approval decision is already being submitted.'
                : 'Approval request is no longer pending.',
              retryable: claim === 'already_claimed',
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
      pending_approval_requests_after_decision: this.activeRuns.listPendingApprovalRequestsByRun(run.run_id),
      original_permission_decision: originalPermissionDecision,
      decision,
      session_id: run.session_id,
      permission_service: this.options.permission_service,
      decided_at: decision.decided_at,
    });
    if (flow.status === 'not_found') {
      this.activeRuns.releaseApprovalClaim(request.approval_request_id);
      return { status: 'not_found', approval_request_id: flow.approval_request_id };
    }
    if (flow.status === 'not_waiting') {
      this.activeRuns.releaseApprovalClaim(request.approval_request_id);
      return { status: 'not_waiting', run: flow.run };
    }
    if (flow.status === 'failed') {
      this.activeRuns.releaseApprovalClaim(request.approval_request_id);
      return { status: 'failed', failure: flow.failure, events: [] };
    }

    const decidedApproval = this.activeRuns.saveApprovalRequest(flow.approval_request);
    const resumedRun = flow.run.status !== run.status
      ? this.activeRuns.saveRun(flow.run)
      : flow.run;
    const approvalStep = this.activeRuns.listSteps(run.run_id).find((step) => (
      step.type === 'tool_call' && step.tool_call_id === approval.subject.tool_call_id
    ));
    if (!approvalStep || approvalStep.type !== 'tool_call') {
      return this.failApprovalResume(resumedRun, {
        code: 'runtime_protocol_violation',
        message: `Tool Call Step was not found for approval: ${approval.subject.tool_call_id}`,
      }, queue, continuation);
    }
    const controller = new AbortController();
    this.activeRunAbortControllers.set(run.run_id, controller);
    const selectedOptionId = decision.decision === 'approved' ? decision.option_id : undefined;
    const selectedScope = selectedOptionId
      ? originalPermissionDecision.options.find((option) => option.option_id === selectedOptionId)?.scope
      : undefined;
    eventSink.emit({
      eventType: 'approval.resolved',
      run,
      payload: {
        approvalRequestId: decidedApproval.approval_request_id,
        toolCallId: approval.subject.tool_call_id,
        decision: decision.decision,
        ...(selectedOptionId ? { optionId: selectedOptionId } : {}),
        ...(selectedScope ? { scope: selectedScope } : {}),
        decidedAt: decision.decided_at,
      },
    });

    const continueAfterAcknowledgement = async () => {
    let currentRun = continuation.current_run;
    if (flow.status === 'denied') {
      this.activeRuns.saveStep({
        ...approvalStep,
        status: 'denied',
        completed_at: this.clock.now(),
      });
      currentRun = { ...currentRun, runItems: [...currentRun.runItems, toolResultToConversationItem(flow.tool_result)] };
      const savedToolResult = this.saveToolResultMessage(
        resumedRun, flow.tool_result, currentRun.lastEntryId ?? currentRun.userEntry.entryId,
      );
      if (savedToolResult.status === 'failed') {
        return this.failApprovalResume(resumedRun, savedToolResult.failure, queue, continuation);
      }
      currentRun = { ...currentRun, lastEntryId: savedToolResult.entry_id };
      eventSink.emit({
        eventType: 'tool_result.created',
        run: resumedRun,
        payload: {
          toolResultId: `tool-result:${approval.subject.tool_call_id}`,
          toolCallId: approval.subject.tool_call_id,
          toolExecutionId: approval.subject.tool_call_id,
          toolName: approval.subject.tool_name,
          kind: 'user_rejected',
          content: [{ type: 'text', text: 'Tool call was rejected by approval decision.' }],
        },
      });
    } else {
      this.activeRuns.saveStep({ ...approvalStep, status: 'executing' });
      const workspaceRoot = this.resolveWorkspaceRoot(run.workspace_id);
      if (workspaceRoot.status === 'failed') {
        return this.failApprovalResume(resumedRun, workspaceRoot.failure, queue, continuation);
      }
      const executeApprovedTool = () => this.resolveToolExecutionService({
        run_id: run.run_id,
        session_id: run.session_id,
        workspace_id: run.workspace_id,
        workspace_root: workspaceRoot.workspace_root,
      }).executeTool({
        toolName: approval.subject.tool_name,
        input: approval.subject.input,
        options: { signal: controller.signal },
      });
      const diagnostic = this.observabilityRuns.get(run.run_id);
      const toolResult = await (diagnostic && this.options.observability
        ? this.options.observability.runInSpanContext(diagnostic.root, executeApprovedTool)
        : executeApprovedTool());
      const afterExecution = this.activeRuns.getRun(run.run_id);
      if (!afterExecution || afterExecution.status === 'cancelled') {
        this.activeRunAbortControllers.delete(run.run_id);
        queue.close();
        if (afterExecution) {
          this.activeRuns.release(run.run_id);
          this.skillServicesByRun.delete(run.run_id);
        }
        return { status: 'not_waiting', run: afterExecution ?? resumedRun };
      }
      const toolFact = mapToolExecutionResultToRuntimeFact({
        tool_call_id: approval.subject.tool_call_id,
        tool_name: approval.subject.tool_name,
        result: toolResult,
        created_at: this.clock.now(),
      });
      currentRun = { ...currentRun, runItems: [...currentRun.runItems, toolResultToConversationItem(toolFact)] };
      this.activeRuns.saveStep({
        ...approvalStep,
        status: toolResult.type === 'succeeded' ? 'completed' : 'failed',
        completed_at: this.clock.now(),
        ...(toolResult.type === 'failed' ? {
          failure: { code: 'tool_call_failed', message: toolResult.error.message },
        } : {}),
      });
      const savedToolResult = this.saveToolResultMessage(
        resumedRun, toolFact, currentRun.lastEntryId ?? currentRun.userEntry.entryId,
      );
      if (savedToolResult.status === 'failed') {
        return this.failApprovalResume(resumedRun, savedToolResult.failure, queue, continuation);
      }
      currentRun = { ...currentRun, lastEntryId: savedToolResult.entry_id };
      eventSink.emit({
        eventType: 'tool_result.created',
        run: resumedRun,
        payload: {
          toolResultId: `tool-result:${toolFact.tool_call_id}`,
          toolCallId: toolFact.tool_call_id,
          toolExecutionId: toolFact.tool_call_id,
          toolName: toolFact.tool_name,
          kind: toolFact.status,
          content: [{
            type: 'text',
            text: toolFact.content ?? toolFact.observation?.summary ?? `${toolFact.tool_name} ${toolFact.status}`,
          }],
          ...(toolFact.error ? { error: toolFact.error } : {}),
        },
      });
      if (toolResult.type === 'succeeded') {
        eventSink.emit({
          eventType: 'tool_call.completed',
          run: resumedRun,
          payload: {
            toolCallId: approval.subject.tool_call_id,
            toolExecutionId: approval.subject.tool_call_id,
            toolName: approval.subject.tool_name,
          },
        });
      } else {
        eventSink.emit({
          eventType: 'tool_call.failed',
          run: resumedRun,
          payload: {
            toolCallId: approval.subject.tool_call_id,
            toolExecutionId: approval.subject.tool_call_id,
            toolName: approval.subject.tool_name,
            error: {
              code: 'tool_execution_failed',
              message: toolResult.error.message,
              severity: 'error',
              retryable: false,
              source: 'tool',
            },
          },
        });
      }
    }

    if (flow.continuation === 'waiting_for_other_approval') {
      this.activeRunAbortControllers.delete(run.run_id);
      this.approvalContinuations.delete(request.approval_request_id);
      const pendingApprovalIds = this.activeRuns
        .listPendingApprovalRequestsByRun(run.run_id)
        .map((approvalRequest) => approvalRequest.approval_request_id);
      for (const pending of this.activeRuns.listPendingApprovalRequestsByRun(run.run_id)) {
        this.approvalContinuations.set(pending.approval_request_id, {
          ...continuation,
          pending_approval_ids: pendingApprovalIds,
          original_approval_policy_by_approval_id: continuation.original_approval_policy_by_approval_id,
          run_id: resumedRun.run_id,
          current_run: currentRun,
          model_config: continuation.model_config,
          permission_mode: continuation.permission_mode,
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
      current_run: currentRun,
      eventSink,
      signal: controller.signal,
    });
    currentRun = deferred.current_run;
    if (deferred.status === 'waiting_for_approval') {
      this.activeRunAbortControllers.delete(run.run_id);
      queue.close();
      return { status: 'resumed', run: deferred.run, events: queue.events() };
    }
    if (deferred.status === 'failed') {
      return this.failApprovalResume(resumedRun, deferred.failure, queue, continuation);
    }

    const execute = () => this.executeRunLoop({
      queue,
      eventSink,
      run: deferred.run,
      current_run: currentRun,
      used_skills: continuation.used_skills,
      skill_catalog: continuation.skill_catalog,
      ...(this.skillServicesByRun.get(run.run_id) ? { skill_service: this.skillServicesByRun.get(run.run_id) } : {}),
      model_context: continuation.model_context,
      model_config: continuation.model_config,
      permission_mode: continuation.permission_mode,
      ...(continuation.workspace_root ? { workspace_root: continuation.workspace_root } : {}),
      signal: controller.signal,
    });
    const diagnostic = this.observabilityRuns.get(run.run_id);
    void (diagnostic ? this.options.observability!.runInSpanContext(diagnostic.root, execute) : execute());
    };
    void continueAfterAcknowledgement().catch((error) => {
      this.failApprovalResume(resumedRun, {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Approval continuation failed.',
      }, queue, continuation);
    });
    return { status: 'resumed', run: resumedRun, events: queue.events() };
  }

  private createEventSink(
    queue: RuntimeEventQueue,
    run?: Pick<AgentRun, 'run_id' | 'session_id'>,
  ): AgentRunRuntimeEventFactory {
    return {
      emit: (runtimeEvent) => {
        const event = createAgentRunRuntimeEvent({
          eventId: this.ids.event_id(),
          sequence: this.nextRuntimeEventSequence((runtimeEvent.run ?? run)?.run_id),
          now: this.clock.now(),
          event: {
            run,
            ...runtimeEvent,
          },
        });
        queue.emit(event);
        return event;
      },
    };
  }

  private saveToolResultMessage(run: AgentRun, toolResult: ToolResultRuntimeFact, parentEntryId: string):
    | { status: 'saved'; entry_id: string }
    | { status: 'failed'; failure: AgentRunFailure } {
    const result = this.options.session_service.saveToolResultMessage({
      message_id: this.ids.tool_result_message_id(),
      session_id: run.session_id,
      run_id: run.run_id,
      parent_entry_id: parentEntryId,
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
    if (result.status === 'saved') {
      this.activeRuns.setLastEntryId(run.run_id, result.entry.entry_id);
      return { status: 'saved', entry_id: result.entry.entry_id };
    }
    return { status: 'failed', failure: { code: 'session_failed', message: result.failure.message } };
  }

  private failApprovalResume(
    run: AgentRun,
    failure: AgentRunFailure,
    queue: RuntimeEventQueue,
    continuation: RunApprovalContinuation,
  ): Extract<ResumeRunAfterApprovalResult, { status: 'failed' }> {
    const latest = this.activeRuns.getRun(run.run_id);
    if (latest && latest.status !== 'completed' && latest.status !== 'failed' && latest.status !== 'cancelled') {
      const terminalReply = commitTerminalReply({
        dependencies: {
          active_run_store: this.activeRuns,
          session_service: this.options.session_service,
          ids: this.ids,
          clock: this.clock,
        },
        run: latest,
        status: 'failed',
        reason_code: assistantReplyReasonForFailure(failure),
      });
      const terminalFailure = terminalReply.status === 'failed'
        ? { code: 'session_failed' as const, message: terminalReply.message }
        : failure;
      const failedRun = this.activeRuns.saveRun(transitionAgentRunStatus({
        run: latest,
        to: 'failed',
        changed_at: this.clock.now(),
        failure: terminalFailure,
      }));
      if (terminalReply.status === 'committed') {
        this.createEventSink(queue, failedRun).emit({
          eventType: 'run.failed',
          run: failedRun,
          messageId: terminalReply.message_id,
          payload: { error: agentRunFailureToRuntimeError(terminalFailure) },
        });
      }
    }
    this.activeRunAbortControllers.get(run.run_id)?.abort();
    this.activeRunAbortControllers.delete(run.run_id);
    this.activeModelCallByRun.delete(run.run_id);
    for (const approvalId of continuation.pending_approval_ids) {
      this.approvalContinuations.delete(approvalId);
    }
    const events = queue.snapshot();
    queue.close();
    this.activeRuns.release(run.run_id);
    this.skillServicesByRun.delete(run.run_id);
    return { status: 'failed', failure, events };
  }

  private nextRuntimeEventSequence(runId: string | undefined): number {
    if (!runId) {
      return 1;
    }
    return this.activeRuns.nextRuntimeEventSequence(runId);
  }

  private async continueDeferredToolCallGroup(input: {
    run: AgentRun;
    continuation: RunApprovalContinuation;
    current_run: CurrentConversationRun;
    eventSink: AgentRunRuntimeEventFactory;
    signal?: AbortSignal;
  }): Promise<
    | { status: 'ready'; run: AgentRun; current_run: CurrentConversationRun }
    | { status: 'waiting_for_approval'; run: AgentRun; current_run: CurrentConversationRun }
    | { status: 'failed'; failure: AgentRunFailure; current_run: CurrentConversationRun }
  > {
    if (input.continuation.deferred_tool_calls.length === 0) {
      return {
        status: 'ready',
        run: input.run,
        current_run: input.current_run,
      };
    }

    const permissionSettings = this.options.settings_service.resolvePermissionSettings({
      workspace_id: input.run.workspace_id,
      session_id: input.run.session_id,
    });
    if (permissionSettings.status === 'failed') {
      return {
        status: 'failed',
        current_run: input.current_run,
        failure: {
          code: 'approval_failed',
          message: permissionSettings.failure.message,
        },
      };
    }

    const tools = this.toolsBuilder.getToolSet({ run_id: input.run.run_id });
    const registeredTools = new Map(
      tools.flatMap((item) => {
        const tool = this.toolsBuilder.getRegisteredTool(input.run.run_id, item.name);
        return tool ? [[item.name, tool] as const] : [];
      }),
    );
    const toolGroup = await orchestrateToolCallGroup({
      run_id: input.run.run_id,
      session_id: input.run.session_id,
      workspace_id: input.run.workspace_id,
      ...(input.continuation.workspace_root ? { workspace_root: input.continuation.workspace_root } : {}),
      permission_mode: input.continuation.permission_mode,
      permission_settings: permissionSettings.permission_settings,
      tools,
      tool_calls: input.continuation.deferred_tool_calls,
      call_order_offset: input.continuation.deferred_call_order_offset,
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
      on_step_transition: (step) => {
        if (this.activeRuns.getRun(step.run_id)?.status !== 'cancelled') {
          this.activeRuns.upsertStep(step);
        }
      },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (this.activeRuns.getRun(input.run.run_id)?.status === 'cancelled') {
      return {
        status: 'failed',
        failure: { code: 'cancel_failed', message: 'Agent Run was cancelled during deferred tool execution.' },
        current_run: input.current_run,
      };
    }

    let currentRun = input.current_run;
    for (const toolCall of toolGroup.tool_calls) {
      emitToolCallTerminalEvent(input.eventSink, input.run, toolCall);
    }
    for (const toolResult of toolGroup.tool_result_facts) {
      emitToolResultRuntimeEvent(input.eventSink, input.run, toolResult);
      const persisted = this.saveToolResultMessage(
        input.run, toolResult, currentRun.lastEntryId ?? currentRun.userEntry.entryId,
      );
      if (persisted.status === 'failed') {
        return { status: 'failed', failure: persisted.failure, current_run: currentRun };
      }
      currentRun = { ...currentRun, lastEntryId: persisted.entry_id };
      currentRun = { ...currentRun, runItems: [...currentRun.runItems, toolResultToConversationItem(toolResult)] };
    }

    if (toolGroup.pending_approvals.length > 0) {
      for (const pendingApproval of toolGroup.pending_approvals) {
        this.activeRuns.createApprovalRequest(pendingApproval.approval_request);
        input.eventSink.emit({
          eventType: 'approval.requested',
          run: input.run,
          payload: {
            approvalRequest: approvalRequestToRuntimePayload(pendingApproval.approval_request),
          },
        });
      }
      const waitingRun = this.activeRuns.saveRun(transitionAgentRunStatus({
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
        deferred_call_order_offset: toolGroup.deferred_call_order_offset,
        current_run: currentRun,
      };
      for (const approvalId of nextContinuation.pending_approval_ids) {
        this.approvalContinuations.set(approvalId, nextContinuation);
      }
      return {
        status: 'waiting_for_approval',
        run: waitingRun,
        current_run: currentRun,
      };
    }

    return {
      status: 'ready',
      run: input.run,
      current_run: currentRun,
    };
  }

  private async executeRunLoop(input: {
    queue: RuntimeEventQueue;
    eventSink: AgentRunRuntimeEventFactory;
    run: AgentRun;
    current_run: CurrentConversationRun;
    skill_catalog: SkillCatalogItem[];
    used_skills: UsedSkillContent[];
    skill_service?: SkillService;
    model_context: ContextCapacity;
    model_config: ModelCallConfig;
    permission_mode: PermissionMode;
    workspace_root?: string;
    signal: AbortSignal;
  }): Promise<void> {
    let retainForApproval = false;
    try {
      const result = await runAgentModelToolLoop({
        active_run_store: this.activeRuns,
        session_service: this.options.session_service,
        settings_service: this.options.settings_service,
        context_service: this.options.context_service,
        model_call_service: this.options.model_call_service,
        tools_builder: this.toolsBuilder,
        tool_execution_service: this.resolveToolExecutionService({
          run_id: input.run.run_id,
          session_id: input.run.session_id,
          workspace_id: input.run.workspace_id,
          ...(input.workspace_root ? { workspace_root: input.workspace_root } : {}),
          ...(input.skill_service ? { skill_service: input.skill_service } : {}),
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
          tool_result_message_id: this.ids.tool_result_message_id,
          approval_request_id: this.ids.approval_request_id,
        },
        clock: this.clock,
        limits: this.limits,
      }, {
        run: input.run,
        current_run: input.current_run,
        skill_catalog: input.skill_catalog,
        used_skills: input.used_skills,
        model_context: input.model_context,
        model_config: input.model_config,
        permission_mode: input.permission_mode,
        ...(input.workspace_root ? { workspace_root: input.workspace_root } : {}),
        signal: input.signal,
      });

      if (this.activeRuns.getRun(input.run.run_id)?.status === 'cancelled') {
        return;
      }

      this.activeModelCallByRun.delete(input.run.run_id);
      if (result.status === 'waiting_for_approval') {
        retainForApproval = true;
        for (const approvalId of result.continuation.pending_approval_ids) {
          this.approvalContinuations.set(approvalId, result.continuation);
          if (this.options.observability) {
            const span = this.options.observability.startSpan({ name: 'approval.wait', correlation: { traceId: input.run.run_id, runId: input.run.run_id, sessionId: input.run.session_id, workspaceId: input.run.workspace_id } });
            this.approvalWaitSpans.set(approvalId, { runId: input.run.run_id, span });
          }
        }
        return;
      }
      this.activeRunAbortControllers.delete(input.run.run_id);
    } catch (error) {
      const latest = this.activeRuns.getRun(input.run.run_id) ?? input.run;
      if (latest.status === 'cancelled') {
        return;
      }
      if (latest.status !== 'completed' && latest.status !== 'failed') {
        const failure: AgentRunFailure = {
          code: 'internal_error',
          message: error instanceof Error ? error.message : 'Agent Run failed unexpectedly.',
        };
        const terminalReply = commitTerminalReply({
          dependencies: {
            active_run_store: this.activeRuns,
            session_service: this.options.session_service,
            ids: this.ids,
            clock: this.clock,
          },
          run: latest,
          status: 'failed',
          reason_code: 'internal_error',
        });
        this.activeRuns.saveRun(transitionAgentRunStatus({
          run: latest,
          to: 'failed',
          changed_at: this.clock.now(),
          failure,
        }));
        if (terminalReply.status === 'committed') {
          input.eventSink.emit({
            eventType: 'run.failed',
            run: input.run,
            messageId: terminalReply.message_id,
            payload: {
              error: agentRunFailureToRuntimeError(failure),
            },
          });
        }
      }
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
      if (!retainForApproval) {
        const latest = this.activeRuns.getRun(input.run.run_id);
        this.endRunObservability(input.run.run_id, latest?.status === 'completed' ? 'ok' : latest?.status === 'cancelled' ? 'cancelled' : 'error');
      }
      this.activeRunAbortControllers.delete(input.run.run_id);
      this.activeModelCallByRun.delete(input.run.run_id);
      if (!retainForApproval) this.activeRuns.release(input.run.run_id);
      if (!retainForApproval) this.skillServicesByRun.delete(input.run.run_id);
      queueMicrotask(() => input.queue.close());
    }
  }

  private startRunObservability(run: AgentRun, requestId: string): { trace: TraceHandle; root: SpanHandle } | undefined {
    if (!this.options.observability) return undefined;
    const trace = this.options.observability.startTrace({ traceId: run.run_id, name: 'agent_run', runId: run.run_id, sessionId: run.session_id, workspaceId: run.workspace_id, requestId, attributes: { providerId: run.model_selection.provider_id, modelId: run.model_selection.model_id } });
    const root = this.options.observability.runInTraceContext(trace, () => this.options.observability!.startSpan({ name: 'agent_run' }));
    const value = { trace, root }; this.observabilityRuns.set(run.run_id, value); return value;
  }

  private endRunObservability(runId: string, status: 'ok' | 'error' | 'cancelled'): void {
    const value = this.observabilityRuns.get(runId); if (!value || !this.options.observability) return;
    this.options.observability.endSpan({ span: value.root, status }); this.options.observability.endTrace({ trace: value.trace, status }); this.observabilityRuns.delete(runId);
  }

  private resolveSession(request: StartRunRequest):
    | { status: 'ok'; session: Session }
    | { status: 'failed'; session?: Session; failure: AgentRunFailure } {
    if (request.session.type === 'existing') {
      const existing = this.options.session_service.getSession({ session_id: request.session.session_id });
      if (existing.status === 'found') return { status: 'ok', session: existing.session };
      return {
        status: 'failed',
        failure: {
          code: 'session_failed',
          message: existing.status === 'failed' ? existing.failure.message : 'Session was not found.',
        },
      };
    }

    const created = this.options.session_service.createSession({
      workspace_id: request.workspace_id,
      initial_user_text: request.user_input.text,
      ...(request.session.title ? { title: request.session.title } : {}),
    });
    if (created.status === 'created') return { status: 'ok', session: created.session };
    return {
      status: 'failed',
      failure: { code: 'session_failed', message: created.failure.message },
    };
  }

  private consumeBranchDraftForRun(
    request: StartRunRequest,
    session: Session,
  ): { status: 'ok'; parent_entry_id?: string } | { status: 'failed'; failure: AgentRunFailure } {
    if (!request.branch_marker_id) {
      return { status: 'ok' };
    }
    if (!this.options.branch_service) {
      return {
        status: 'failed',
        failure: {
          code: 'session_failed',
          message: 'Branch draft service is not available.',
        },
      };
    }

    const consumed = this.options.branch_service.consumeBranchDraft({
      session_id: session.session_id,
      branch_marker_id: request.branch_marker_id,
    });
    if (consumed.status !== 'consumed') {
      return {
        status: 'failed',
        failure: {
          code: 'session_failed',
          message: consumed.reason === 'branch_marker_not_found'
            ? 'Branch draft was not found.'
            : 'Branch draft does not belong to the active session.',
        },
      };
    }

    return { status: 'ok', parent_entry_id: consumed.branch_draft.source_entry_id };
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
    skill_service?: SkillService;
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

  private async resolveCommandSkills(input: {
    requested_skill?: SkillSelection;
    skill_service?: SkillService;
  }): Promise<
    | { status: 'ok'; used_skills: UsedSkillContent[] }
    | { status: 'failed'; failure: AgentRunFailure }
  > {
    if (!input.requested_skill) {
      return { status: 'ok', used_skills: [] };
    }
    if (!input.skill_service) {
      return {
        status: 'failed',
        failure: {
          code: 'runtime_protocol_violation',
          message: 'Skill Service is not configured for the requested Skill.',
        },
      };
    }

    const used = await input.skill_service.useSkill({ skillPath: input.requested_skill.skillPath });
    if (used.status === 'ok') {
      return {
        status: 'ok',
        used_skills: [usedSkillContent(used.skill)],
      };
    }
    return {
      status: 'failed',
      failure: {
        code: 'runtime_protocol_violation',
        message: used.status === 'failed'
          ? used.message
          : `Skill ${used.skillPath} is ${used.status === 'not_found' ? 'not found' : 'unavailable'}.`,
      },
    };
  }

  private routeCommandResult(
    request: StartRunRequest,
    session: Session,
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
          session,
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
          session,
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
          session,
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

function emitToolResultRuntimeEvent(
  eventSink: AgentRunRuntimeEventFactory,
  run: AgentRun,
  toolResult: ToolResultRuntimeFact,
): void {
  eventSink.emit({
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

function emitToolCallTerminalEvent(
  eventSink: AgentRunRuntimeEventFactory,
  run: AgentRun,
  toolCall: ToolCallStep,
): void {
  if (toolCall.status === 'completed') {
    eventSink.emit({
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
    eventSink.emit({
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

type RuntimeEventQueue = {
  emit(event: RuntimeEvent): void;
  close(): void;
  snapshot(): RuntimeEvent[];
  events(): AsyncIterable<RuntimeEvent>;
};

function createAgentRunEventQueue(
  publish: (event: RuntimeEvent) => void,
): RuntimeEventQueue {
  const events: RuntimeEvent[] = [];
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

function toolResultToConversationItem(toolResult: ToolResultRuntimeFact): CurrentConversationRun['runItems'][number] {
  return {
    type: 'tool_result',
    toolCallId: toolResult.tool_call_id,
    toolName: toolResult.tool_name,
    status: toolResult.status === 'success' ? 'success' : 'failure',
    content: [{ type: 'text', text: toolResult.content ?? toolResult.observation?.summary ?? `${toolResult.tool_name} ${toolResult.status}` }],
  };
}

function usedSkillContent(skill: UsedSkillContent): UsedSkillContent {
  return {
    name: skill.name,
    skillPath: skill.skillPath,
    content: skill.content,
  };
}

function currentRunFromSavedUserMessage(
  runId: string,
  saved: SessionMessageWithAttachments,
  entry: SessionEntry,
): CurrentConversationRun {
  return {
    runId,
    lastEntryId: entry.entry_id,
    userEntry: {
      entryId: entry.entry_id,
      ...(entry.parent_entry_id ? { parentEntryId: entry.parent_entry_id } : {}),
    },
    userMessage: {
      type: 'user_message',
      content: [
        ...(saved.message.message_kind === 'user_message' ? saved.message.content : []),
        ...saved.attachments.map((attachment) => attachment.type === 'image'
          ? {
              type: 'image' as const,
              source: { type: 'host_reference' as const, referenceId: attachment.attachment_id },
            }
          : {
              type: 'file' as const,
              fileId: attachment.attachment_id,
              ...(attachment.name ? { name: attachment.name } : {}),
              ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
            }),
      ],
    },
    runItems: [],
  };
}

function failedStart(request: StartRunRequest, failure: AgentRunFailure): Extract<StartRunResult, { status: 'failed' }> {
  return {
    status: 'failed',
    request_id: request.request_id,
    failure,
  };
}

