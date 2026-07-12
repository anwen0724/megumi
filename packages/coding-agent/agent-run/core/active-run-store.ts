/*
 * Owns process-local Agent Run lifecycle, Run Steps, approvals, and event
 * sequencing. No value in this store is recoverable after process restart.
 */
import type {
  AgentRun,
  AgentRunApprovalRequest,
  RunStep,
} from '../contracts/agent-run-contracts';

export interface ActiveRunRecord {
  run: AgentRun;
  steps: RunStep[];
}

export class ActiveRunStore {
  private readonly runs = new Map<string, ActiveRunRecord>();
  private readonly approvals = new Map<string, AgentRunApprovalRequest>();
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
    return request;
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
