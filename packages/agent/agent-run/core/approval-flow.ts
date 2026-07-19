/*
 * Agent Run approval wait/resume rules.
 * This file owns approval lifecycle decisions without storing full run continuation state.
 */
import type { ApprovalOption, PermissionDecision, PermissionService } from '../../permissions';
import type {
  AgentRun,
  AgentRunApprovalRequest,
  AgentRunApprovalSubject,
  AgentRunFailure,
  ApprovalDecision,
} from '../contracts/agent-run-contracts';
import type { ToolResultRuntimeFact } from '../contracts/model-call-contracts';
import { transitionAgentRunStatus } from './run-lifecycle';

export type ApprovalWaitRepository = {
  saveRun(run: AgentRun): AgentRun;
  createApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest;
};

export type CreateApprovalWaitRequest = {
  run: AgentRun;
  approval_request_id: string;
  subject: AgentRunApprovalSubject;
  options: ApprovalOption[];
  default_option_id: string;
  repository: ApprovalWaitRepository;
  changed_at: string;
};

export type CreateApprovalWaitResult = {
  run: AgentRun;
  approval_request: AgentRunApprovalRequest;
};

export type ResumeApprovalFlowRequest = {
  run: AgentRun;
  approval_request?: AgentRunApprovalRequest;
  pending_approval_requests_after_decision: AgentRunApprovalRequest[];
  original_permission_decision: PermissionDecision;
  decision: ApprovalDecision;
  session_id: string;
  permission_service: Pick<PermissionService, 'applyApprovalDecision'>;
  decided_at: string;
};

export type ResumeApprovalFlowResult =
  | { status: 'not_found'; approval_request_id: string }
  | { status: 'not_waiting'; run: AgentRun }
  | { status: 'failed'; failure: AgentRunFailure }
  | {
      status: 'approved';
      run: AgentRun;
      approval_request: AgentRunApprovalRequest;
      continuation: 'continue_tool_group' | 'waiting_for_other_approval';
      next_model_prompt_ready: false;
    }
  | {
      status: 'denied';
      run: AgentRun;
      approval_request: AgentRunApprovalRequest;
      tool_result: ToolResultRuntimeFact;
      continuation: 'waiting_for_other_approval' | 'next_model_prompt';
      next_model_prompt_ready: boolean;
    };

export function createApprovalWait(request: CreateApprovalWaitRequest): CreateApprovalWaitResult {
  const run = request.repository.saveRun(transitionAgentRunStatus({
    run: request.run,
    to: 'waiting_for_approval',
    changed_at: request.changed_at,
  }));
  const approvalRequest = request.repository.createApprovalRequest({
    approval_request_id: request.approval_request_id,
    run_id: request.run.run_id,
    subject: request.subject,
    status: 'pending',
    options: request.options,
    default_option_id: request.default_option_id,
    created_at: request.changed_at,
  });

  return {
    run,
    approval_request: approvalRequest,
  };
}

export async function resumeApprovalFlow(
  request: ResumeApprovalFlowRequest,
): Promise<ResumeApprovalFlowResult> {
  if (!request.approval_request) {
    return { status: 'not_found', approval_request_id: request.decision.approval_request_id };
  }
  if (request.run.status !== 'waiting_for_approval') {
    return { status: 'not_waiting', run: request.run };
  }
  if (request.approval_request.status !== 'pending') {
    return failedApproval(`Approval request is not pending: ${request.approval_request.status}`);
  }
  if (request.original_permission_decision.type !== 'requires_approval') {
    return failedApproval('Original permission decision does not require approval.');
  }

  const application = await request.permission_service.applyApprovalDecision({
    session_id: request.session_id,
    original_permission_decision: request.original_permission_decision,
    decision: request.decision,
    applied_at: request.decided_at,
  });
  if (application.status === 'failed') {
    return { status: 'failed', failure: approvalFailure(application.failure.message) };
  }
  if (application.status === 'rejected') {
    return { status: 'failed', failure: approvalFailure(application.message) };
  }

  const updatedApproval: AgentRunApprovalRequest = {
    ...request.approval_request,
    status: request.decision.decision,
    decided_at: request.decided_at,
    decision: request.decision,
  };

  const hasOtherPendingApproval = request.pending_approval_requests_after_decision
    .some((approval) => approval.status === 'pending' && approval.approval_request_id !== updatedApproval.approval_request_id);
  const run = hasOtherPendingApproval
    ? request.run
    : transitionAgentRunStatus({
        run: request.run,
        to: 'running',
        changed_at: request.decided_at,
      });

  if (request.decision.decision === 'approved') {
    return {
      status: 'approved',
      run,
      approval_request: updatedApproval,
      continuation: hasOtherPendingApproval ? 'waiting_for_other_approval' : 'continue_tool_group',
      next_model_prompt_ready: false,
    };
  }

  return {
    status: 'denied',
    run,
    approval_request: updatedApproval,
    tool_result: deniedToolResult(updatedApproval, request.decision.reason ?? 'Approval denied.', request.decided_at),
    continuation: hasOtherPendingApproval ? 'waiting_for_other_approval' : 'next_model_prompt',
    next_model_prompt_ready: !hasOtherPendingApproval,
  };
}

function deniedToolResult(
  approvalRequest: AgentRunApprovalRequest,
  reason: string,
  createdAt: string,
): ToolResultRuntimeFact {
  return {
    tool_call_id: approvalRequest.subject.tool_call_id,
    tool_name: approvalRequest.subject.tool_name,
    status: 'user_rejected',
    error: { code: 'user_rejected', message: reason },
    content: reason,
    created_at: createdAt,
  };
}

function failedApproval(message: string): ResumeApprovalFlowResult {
  return {
    status: 'failed',
    failure: approvalFailure(message),
  };
}

function approvalFailure(message: string): AgentRunFailure {
  return {
    code: 'approval_failed',
    message,
  };
}
