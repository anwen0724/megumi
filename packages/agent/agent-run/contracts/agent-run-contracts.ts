/*
 * Stable public contracts for Agent Run orchestration.
 * These types describe run lifecycle, approval resume, and host-facing results.
 */
import type { CommandAgentRunInput, HostInteractionRequest } from '../../commands';
import type { RawUserInput } from '../../input';
import type { ApprovalDecision, ApprovalOption, PermissionMode } from '../../permissions';
import type { ProviderRuntimeConfig } from '../../settings';
import type { RuntimeEvent } from '../../events';
import type { Session, SessionMessageWithAttachments } from '../../session';

export type AgentRunModelSelection = {
  provider_id: string;
  model_id: string;
};

export type ApprovalDecisionIntent =
  | Omit<Extract<ApprovalDecision, { decision: 'approved' }>, 'decided_at'>
  | Omit<Extract<ApprovalDecision, { decision: 'denied' }>, 'decided_at'>;

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

export type AgentRunFailure = {
  code:
    | 'input_failed'
    | 'command_failed'
    | 'session_failed'
    | 'context_failed'
    | 'model_call_failed'
    | 'unsupported_content'
    | 'tool_call_failed'
    | 'approval_failed'
    | 'cancel_failed'
    | 'loop_limit_exceeded'
    | 'runtime_protocol_violation'
    | 'runtime_interrupted'
    | 'internal_error';
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export type AgentRun = {
  run_id: string;
  workspace_id: string;
  session_id: string;
  model_selection: AgentRunModelSelection;
  trigger:
    | { type: 'user_input'; user_message_id: string }
    | { type: 'command'; command_name: string; user_message_id?: string };
  status: AgentRunStatus;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  failure?: AgentRunFailure;
};

export type ModelCallStep = {
  type: 'model_call';
  run_id: string;
  model_call_id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at?: string;
  failure?: AgentRunFailure;
};

export type ToolCallStep = {
  type: 'tool_call';
  tool_call_id: string;
  run_id: string;
  source_model_call_id: string;
  call_order: number;
  tool_name: string;
  input: unknown;
  arguments_text: string;
  status:
    | 'requested'
    | 'waiting_for_approval'
    | 'executing'
    | 'completed'
    | 'failed'
    | 'denied'
    | 'cancelled';
  approval_request_id?: string;
  created_at: string;
  completed_at?: string;
  failure?: AgentRunFailure;
};

export type RunStep = ModelCallStep | ToolCallStep;

export type AgentRunApprovalSubject =
  | {
      type: 'tool_call';
      tool_call_id: string;
      tool_name: string;
      input: unknown;
    };

export type AgentRunApprovalRequest = {
  approval_request_id: string;
  run_id: string;
  subject: AgentRunApprovalSubject;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  options: ApprovalOption[];
  default_option_id: string;
  summary?: string;
  preview?: {
    action: string;
    targets: Array<{
      kind: string;
      label: string;
    }>;
  };
  created_at: string;
  decided_at?: string;
  decision?: ApprovalDecision;
};

export type StartRunRequest = {
  request_id: string;
  workspace_id: string;
  session:
    | { type: 'existing'; session_id: string }
    | { type: 'new'; title?: string };
  branch_marker_id?: string;
  user_input: RawUserInput;
  model_selection: AgentRunModelSelection;
  permission_mode?: PermissionMode;
};

export type StartRunResult =
  | {
      status: 'started';
      request_id: string;
      run: AgentRun;
      session: Session;
      user_message_id: string;
      user_message: SessionMessageWithAttachments;
      events: AsyncIterable<RuntimeEvent>;
    }
  | {
      status: 'host_interaction_required';
      request_id: string;
      session?: Session;
      interaction: HostInteractionRequest;
      events?: RuntimeEvent[];
    }
  | {
      status: 'completed';
      request_id: string;
      session?: Session;
      message?: string;
      events?: RuntimeEvent[];
    }
  | {
      status: 'failed';
      request_id: string;
      session?: Session;
      failure: AgentRunFailure;
      events?: RuntimeEvent[];
    };

export type CancelRunRequest = {
  run_id: string;
};

export type CancelRunResult =
  | { status: 'cancelled'; run: AgentRun; events: RuntimeEvent[] }
  | { status: 'not_found'; run_id: string }
  | { status: 'not_cancellable'; run: AgentRun; reason: 'already_terminal' | 'not_running' }
  | { status: 'failed'; failure: AgentRunFailure; events?: RuntimeEvent[] };

export type ResumeRunAfterApprovalRequest = {
  approval_request_id: string;
  decision: ApprovalDecisionIntent;
};

export type ResumeRunAfterApprovalResult =
  | { status: 'resumed'; run: AgentRun; events: AsyncIterable<RuntimeEvent> }
  | { status: 'not_found'; approval_request_id: string }
  | { status: 'not_waiting'; run: AgentRun }
  | { status: 'failed'; failure: AgentRunFailure; events?: RuntimeEvent[] };

export type AgentRunCommandInput = CommandAgentRunInput;
export type AgentRunModelConfig = ProviderRuntimeConfig;
export type { ApprovalDecision, PermissionMode };

export type AgentRunService = {
  startRun(request: StartRunRequest): Promise<StartRunResult>;
  cancelRun(request: CancelRunRequest): Promise<CancelRunResult> | CancelRunResult;
  resumeRunAfterApproval(
    request: ResumeRunAfterApprovalRequest,
  ): Promise<ResumeRunAfterApprovalResult> | ResumeRunAfterApprovalResult;
};
