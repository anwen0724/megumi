/*
 * Stable public contracts for Agent Run orchestration.
 * These types describe run lifecycle, approval resume, and host-facing results.
 */
import type { CommandAgentRunInput, HostInteractionRequest } from '../../commands';
import type { RawUserInput } from '../../input';
import type { ApprovalDecision, ApprovalScope, PermissionMode } from '../../permissions';
import type { ProviderRuntimeConfig } from '../../settings';

export type AgentRunModelSelection = {
  provider_id: string;
  model_id: string;
};

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
    | 'tool_call_failed'
    | 'approval_failed'
    | 'cancel_failed'
    | 'recovery_failed'
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

export type AgentRunStep = {
  step_id: string;
  run_id: string;
  type: 'model_call' | 'tool_call' | 'approval_wait' | 'context_compaction';
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  completed_at?: string;
  failure?: AgentRunFailure;
};

export type AgentRunToolCall = {
  tool_call_id: string;
  run_id: string;
  step_id?: string;
  call_order: number;
  tool_name: string;
  input: unknown;
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
  created_at: string;
  decided_at?: string;
  decision?: ApprovalDecision;
};

export type AgentRunEvent = {
  event_id: string;
  type: string;
  run_id?: string;
  session_id?: string;
  created_at: string;
  payload?: Record<string, unknown>;
};

export type StartRunRequest = {
  request_id: string;
  workspace_id: string;
  session:
    | { type: 'existing'; session_id: string }
    | { type: 'new'; title?: string };
  user_input: RawUserInput;
  model_selection: AgentRunModelSelection;
  permission_mode?: PermissionMode;
};

export type StartRunResult =
  | {
      status: 'started';
      request_id: string;
      run: AgentRun;
      session_id: string;
      user_message_id: string;
      events: AsyncIterable<AgentRunEvent>;
    }
  | {
      status: 'host_interaction_required';
      request_id: string;
      session_id?: string;
      interaction: HostInteractionRequest;
    }
  | {
      status: 'completed';
      request_id: string;
      session_id?: string;
      message?: string;
      events?: AgentRunEvent[];
    }
  | {
      status: 'failed';
      request_id: string;
      session_id?: string;
      failure: AgentRunFailure;
      events?: AgentRunEvent[];
    };

export type CancelRunRequest = {
  run_id: string;
};

export type CancelRunResult =
  | { status: 'cancelled'; run: AgentRun; events: AgentRunEvent[] }
  | { status: 'not_found'; run_id: string }
  | { status: 'not_cancellable'; run: AgentRun; reason: 'already_terminal' | 'not_running' }
  | { status: 'failed'; failure: AgentRunFailure; events?: AgentRunEvent[] };

export type ResumeRunAfterApprovalRequest = {
  approval_request_id: string;
  decision: ApprovalDecision;
};

export type ResumeRunAfterApprovalResult =
  | { status: 'resumed'; run: AgentRun; events: AsyncIterable<AgentRunEvent> }
  | { status: 'not_found'; approval_request_id: string }
  | { status: 'not_waiting'; run: AgentRun }
  | { status: 'failed'; failure: AgentRunFailure; events?: AgentRunEvent[] };

export type CleanupInterruptedRunsRequest = {
  reason: 'runtime_started' | 'runtime_recovered';
};

export type CleanupInterruptedRunsResult =
  | { status: 'completed'; cleaned_run_ids: string[]; events: AgentRunEvent[] }
  | { status: 'failed'; failure: AgentRunFailure; events?: AgentRunEvent[] };

export type AgentRunCommandInput = CommandAgentRunInput;
export type AgentRunModelConfig = ProviderRuntimeConfig;
export type { ApprovalDecision, ApprovalScope, PermissionMode };

export type AgentRunService = {
  startRun(request: StartRunRequest): Promise<StartRunResult>;
  cancelRun(request: CancelRunRequest): Promise<CancelRunResult> | CancelRunResult;
  resumeRunAfterApproval(
    request: ResumeRunAfterApprovalRequest,
  ): Promise<ResumeRunAfterApprovalResult> | ResumeRunAfterApprovalResult;
  cleanupInterruptedRuns(
    request: CleanupInterruptedRunsRequest,
  ): Promise<CleanupInterruptedRunsResult> | CleanupInterruptedRunsResult;
};
