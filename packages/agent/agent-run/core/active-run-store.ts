/*
 * Owns process-local Agent Run lifecycle, Run Steps, approvals, and event
 * sequencing. No value in this store is recoverable after process restart.
 */
import type {
  AgentRun,
  AgentRunApprovalRequest,
  RunStep,
} from '../contracts/agent-run-contracts';
import type { AssistantContentBlock } from '../../model-content';

export type ActiveModelResponseDraft = {
  run_id: string;
  model_call_id: string;
  message_id: string;
  parent_entry_id: string;
  content: AssistantContentBlock[];
  has_pending_work_tool_call: boolean;
};

export interface ActiveRunRecord {
  run: AgentRun;
  steps: RunStep[];
  last_entry_id?: string;
  active_model_response?: ActiveModelResponseDraft;
}

export class ActiveRunStore {
  private readonly runs = new Map<string, ActiveRunRecord>();
  private readonly approvals = new Map<string, AgentRunApprovalRequest>();
  private readonly approvalClaims = new Set<string>();
  private readonly eventSequences = new Map<string, number>();

  createRun(run: AgentRun): AgentRun {
    if (this.runs.has(run.run_id)) throw new Error(`Active Run already exists: ${run.run_id}`);
    this.runs.set(run.run_id, { run, steps: [] });
    return run;
  }

  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId)?.run;
  }

  saveRun(run: AgentRun): AgentRun {
    const record = this.requireRun(run.run_id);
    this.runs.set(run.run_id, { ...record, run });
    return run;
  }

  listRuns(): AgentRun[] {
    return [...this.runs.values()].map((record) => record.run);
  }

  initializeExecution(runId: string, lastEntryId: string): void {
    const record = this.requireRun(runId);
    this.runs.set(runId, { ...record, last_entry_id: lastEntryId });
  }

  getLastEntryId(runId: string): string | undefined {
    return this.runs.get(runId)?.last_entry_id;
  }

  setLastEntryId(runId: string, entryId: string): void {
    const record = this.requireRun(runId);
    this.runs.set(runId, { ...record, last_entry_id: entryId });
  }

  getActiveModelResponse(runId: string): ActiveModelResponseDraft | undefined {
    return this.runs.get(runId)?.active_model_response;
  }

  setActiveModelResponse(draft: ActiveModelResponseDraft): void {
    const record = this.requireRun(draft.run_id);
    this.runs.set(draft.run_id, { ...record, active_model_response: draft });
  }

  updateActiveModelResponse(
    runId: string,
    update: Partial<Pick<ActiveModelResponseDraft, 'content' | 'has_pending_work_tool_call'>>,
  ): void {
    const record = this.requireRun(runId);
    if (!record.active_model_response) return;
    this.runs.set(runId, {
      ...record,
      active_model_response: { ...record.active_model_response, ...update },
    });
  }

  clearActiveModelResponse(runId: string): void {
    const record = this.requireRun(runId);
    const { active_model_response: _discarded, ...next } = record;
    this.runs.set(runId, next);
  }

  addStep(step: RunStep): RunStep {
    const record = this.requireRun(step.run_id);
    if (record.steps.some((item) => stepIdentity(item) === stepIdentity(step))) {
      throw new Error(`Run Step already exists: ${stepIdentity(step)}`);
    }
    record.steps.push(step);
    return step;
  }

  saveStep(step: RunStep): RunStep {
    const record = this.requireRun(step.run_id);
    const identity = stepIdentity(step);
    const index = record.steps.findIndex((item) => stepIdentity(item) === identity);
    if (index < 0) throw new Error(`Run Step was not found: ${identity}`);
    record.steps[index] = step;
    return step;
  }

  upsertStep(step: RunStep): RunStep {
    const identity = stepIdentity(step);
    const existing = this.listSteps(step.run_id).some((item) => stepIdentity(item) === identity);
    return existing ? this.saveStep(step) : this.addStep(step);
  }

  listSteps(runId: string): RunStep[] {
    return [...(this.runs.get(runId)?.steps ?? [])];
  }

  createApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest {
    if (this.approvals.has(request.approval_request_id)) {
      throw new Error(`Approval request already exists: ${request.approval_request_id}`);
    }
    this.approvals.set(request.approval_request_id, request);
    return request;
  }

  getApprovalRequest(approvalRequestId: string): AgentRunApprovalRequest | undefined {
    return this.approvals.get(approvalRequestId);
  }

  saveApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest {
    if (!this.approvals.has(request.approval_request_id)) {
      throw new Error(`Approval request was not found: ${request.approval_request_id}`);
    }
    this.approvals.set(request.approval_request_id, request);
    if (request.status !== 'pending') this.approvalClaims.delete(request.approval_request_id);
    return request;
  }

  claimApprovalRequest(approvalRequestId: string): 'claimed' | 'not_found' | 'not_pending' | 'already_claimed' {
    const approval = this.approvals.get(approvalRequestId);
    if (!approval) return 'not_found';
    if (approval.status !== 'pending') return 'not_pending';
    if (this.approvalClaims.has(approvalRequestId)) return 'already_claimed';
    this.approvalClaims.add(approvalRequestId);
    return 'claimed';
  }

  releaseApprovalClaim(approvalRequestId: string): void {
    this.approvalClaims.delete(approvalRequestId);
  }

  listPendingApprovalRequestsByRun(runId: string): AgentRunApprovalRequest[] {
    return [...this.approvals.values()]
      .filter((request) => request.run_id === runId && request.status === 'pending')
      .sort((left, right) => left.created_at.localeCompare(right.created_at)
        || left.approval_request_id.localeCompare(right.approval_request_id));
  }

  nextRuntimeEventSequence(runId: string): number {
    const next = (this.eventSequences.get(runId) ?? 0) + 1;
    this.eventSequences.set(runId, next);
    return next;
  }

  release(runId: string): void {
    this.runs.delete(runId);
    this.eventSequences.delete(runId);
    for (const [approvalId, approval] of this.approvals) {
      if (approval.run_id === runId) this.approvals.delete(approvalId);
      if (approval.run_id === runId) this.approvalClaims.delete(approvalId);
    }
  }

  private requireRun(runId: string): ActiveRunRecord {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Active Run was not found: ${runId}`);
    return record;
  }
}

function stepIdentity(step: RunStep): string {
  return step.type === 'model_call' ? `model:${step.model_call_id}` : `tool:${step.tool_call_id}`;
}
