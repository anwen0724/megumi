/*
 * Public Agent Run Service factory.
 * It owns user-input-to-run orchestration and delegates model/tool looping to core.
 */
import type { CommandExecutionResult } from '../../commands';
import type { InputService, ParsedUserInput } from '../../input';
import type { PermissionMode, PermissionService } from '../../permissions';
import type { SessionService } from '../../session';
import type { SettingsService } from '../../settings';
import type { ToolExecutionService, ToolRegistryService } from '../../tools';
import type { WorkspacePathPolicyService } from '../../workspace';
import type {
  AgentRun,
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
import type { ModelCallService } from '../contracts/model-call-contracts';
import { runAgentModelToolLoop } from '../core/run-orchestrator';
import { transitionAgentRunStatus } from '../core/run-lifecycle';
import { createRunToolSetBuilder } from '../core/tool-set-builder';
import type { AgentRunRepository } from '../repositories/agent-run-repository';

export type CreateAgentRunServiceOptions = {
  repository: AgentRunRepository;
  input_service: Pick<InputService, 'processUserInput'>;
  command_service: {
    handleCommandInput(request: { raw_input: string; execution_context?: { session_id: string; workspace_id?: string } }): Promise<CommandExecutionResult>;
  };
  session_service: Pick<SessionService, 'createSession' | 'getSession' | 'saveUserMessage' | 'saveAssistantMessage'>;
  settings_service: Pick<SettingsService, 'resolveProviderRuntimeConfig' | 'resolvePermissionSettings'>;
  context_service: Parameters<typeof runAgentModelToolLoop>[0]['context_service'];
  model_call_service: ModelCallService;
  tool_registry_service: Pick<ToolRegistryService, 'listAvailableTools'>;
  tool_execution_service: Pick<ToolExecutionService, 'executeTool'>;
  permission_service: Pick<PermissionService, 'evaluateToolExecution'>;
  workspace_path_policy_service?: Pick<WorkspacePathPolicyService, 'classifyPath'>;
  memory_service?: Parameters<typeof runAgentModelToolLoop>[0]['memory_service'];
  event_publisher?: {
    publish(event: AgentRunEvent): AgentRunEvent | void;
  };
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
  private readonly ids: AgentRunServiceIds;
  private readonly clock: { now(): string };
  private readonly limits: AgentRunLoopLimits;

  constructor(private readonly options: CreateAgentRunServiceOptions) {
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
      max_model_calls: options.limits?.max_model_calls ?? 12,
      max_tool_rounds: options.limits?.max_tool_rounds ?? 6,
    };
  }

  async startRun(request: StartRunRequest): Promise<StartRunResult> {
    const events: AgentRunEvent[] = [];
    const eventSink = {
      emit: (type: string, payload?: Record<string, unknown>) => {
        const event: AgentRunEvent = {
          event_id: this.ids.event_id(),
          type,
          created_at: this.clock.now(),
          ...(payload?.run_id && typeof payload.run_id === 'string' ? { run_id: payload.run_id } : {}),
          ...(payload ? { payload } : {}),
        };
        events.push(event);
        this.options.event_publisher?.publish(event);
        return event;
      },
    };

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
          execution_context: {
            session_id: session.session_id,
            workspace_id: request.workspace_id,
          },
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

    let run = this.options.repository.createRun({
      run_id: runId,
      workspace_id: request.workspace_id,
      session_id: session.session_id,
      model_selection: request.model_selection,
      trigger: triggerForRun(userMessageId, commandRoute.command_result),
      status: 'queued',
      created_at: this.clock.now(),
    });
    run = this.options.repository.saveRun(transitionAgentRunStatus({
      run,
      to: 'running',
      changed_at: this.clock.now(),
    }));
    eventSink.emit('run.started', { run_id: run.run_id, session_id: run.session_id });

    await runAgentModelToolLoop({
      repository: this.options.repository,
      session_service: this.options.session_service,
      settings_service: this.options.settings_service,
      context_service: this.options.context_service,
      model_call_service: this.options.model_call_service,
      tool_set_builder: createRunToolSetBuilder({ tool_registry_service: this.options.tool_registry_service }),
      tool_execution_service: this.options.tool_execution_service,
      permission_service: this.options.permission_service,
      ...(this.options.workspace_path_policy_service ? { workspace_path_policy_service: this.options.workspace_path_policy_service } : {}),
      ...(this.options.memory_service ? { memory_service: this.options.memory_service } : {}),
      event_sink: eventSink,
      ids: {
        assistant_message_id: this.ids.assistant_message_id,
        approval_request_id: this.ids.approval_request_id,
      },
      clock: this.clock,
      limits: this.limits,
    }, {
      run,
      user_message_id: userMessageId,
      model_config: modelConfig.config,
      permission_mode: request.permission_mode ?? 'default',
    });

    return {
      status: 'started',
      request_id: request.request_id,
      run,
      session_id: session.session_id,
      user_message_id: userMessageId,
      events: asyncEvents(events),
    };
  }

  cancelRun(request: CancelRunRequest): CancelRunResult {
    const run = this.options.repository.getRun(request.run_id);
    if (!run) return { status: 'not_found', run_id: request.run_id };
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return { status: 'not_cancellable', run, reason: 'already_terminal' };
    }
    const cancelling = this.options.repository.saveRun(transitionAgentRunStatus({
      run,
      to: 'cancelling',
      changed_at: this.clock.now(),
    }));
    const cancelled = this.options.repository.saveRun(transitionAgentRunStatus({
      run: cancelling,
      to: 'cancelled',
      changed_at: this.clock.now(),
    }));
    return { status: 'cancelled', run: cancelled, events: [] };
  }

  resumeRunAfterApproval(request: ResumeRunAfterApprovalRequest): ResumeRunAfterApprovalResult {
    return { status: 'not_found', approval_request_id: request.approval_request_id };
  }

  cleanupInterruptedRuns(_request: CleanupInterruptedRunsRequest): CleanupInterruptedRunsResult {
    return { status: 'completed', cleaned_run_ids: [], events: [] };
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

function failedStart(request: StartRunRequest, failure: AgentRunFailure): Extract<StartRunResult, { status: 'failed' }> {
  return {
    status: 'failed',
    request_id: request.request_id,
    failure,
  };
}

async function* asyncEvents(events: AgentRunEvent[]): AsyncIterable<AgentRunEvent> {
  yield* events;
}
