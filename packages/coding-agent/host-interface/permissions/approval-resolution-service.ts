// Resolves tool approval decisions for host interfaces and resumes the agent loop when needed.
import type { ApprovalResolveData, ApprovalResolvePayload } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ApprovalRecord, ApprovalRequest } from '@megumi/shared/tool';

export interface ApprovalResolutionRepository {
  getApprovalRequest(approvalRequestId: string): ApprovalRequest | undefined;
  resolveApprovalRequest(record: ApprovalRecord): ApprovalRecord;
  createApprovalRequest(request: ApprovalRequest): ApprovalRequest;
}

export interface ApprovalResumeInput {
  approvalRequestId: string;
  decision: 'approved' | 'denied';
  decidedAt: string;
  reason?: string;
}

export interface ApprovalResolutionServiceOptions {
  repository: ApprovalResolutionRepository;
  resumeApproval?: (input: ApprovalResumeInput) => AsyncIterable<RuntimeEvent> | undefined;
  now?: () => string;
  idFactory?: {
    approvalRecordId(): string;
  };
}

export interface ApprovalResolutionResult {
  data: ApprovalResolveData;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ApprovalResolutionPort {
  resolve(payload: ApprovalResolvePayload): ApprovalResolutionResult;
}

export class ApprovalResolutionService implements ApprovalResolutionPort {
  private readonly now: () => string;
  private readonly idFactory: { approvalRecordId(): string };

  constructor(private readonly options: ApprovalResolutionServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? {
      approvalRecordId: () => `approval-record:${crypto.randomUUID()}`,
    };
  }

  resolve(payload: ApprovalResolvePayload): ApprovalResolutionResult {
    const request = this.options.repository.getApprovalRequest(payload.approvalRequestId);
    if (!request) {
      throw new Error(`Approval request not found: ${payload.approvalRequestId}`);
    }
    if (request.status !== 'pending') {
      throw new Error(`Approval request already resolved: ${payload.approvalRequestId}`);
    }

    const approval = this.options.repository.resolveApprovalRequest(this.createApprovalRecord(request, payload));
    this.options.repository.createApprovalRequest({
      ...request,
      status: payload.decision,
      resolvedAt: approval.decidedAt,
    });

    return {
      data: { approval },
      events: this.options.resumeApproval?.({
        approvalRequestId: request.approvalRequestId,
        decision: payload.decision,
        decidedAt: approval.decidedAt,
        ...(payload.reason ? { reason: payload.reason } : {}),
      }),
    };
  }

  private createApprovalRecord(
    request: ApprovalRequest,
    payload: ApprovalResolvePayload,
  ): ApprovalRecord {
    return {
      approvalRecordId: this.idFactory.approvalRecordId(),
      approvalRequestId: request.approvalRequestId,
      toolCallId: request.toolCallId,
      toolExecutionId: request.toolExecutionId,
      runId: request.runId,
      stepId: request.stepId,
      decision: payload.decision,
      scope: payload.scope,
      decidedBy: 'user',
      ...(payload.reason ? { reason: payload.reason } : {}),
      decidedAt: payload.decidedAt ?? this.now(),
    };
  }
}
