import { useMemo } from 'react';
import type { ToolCall, ApprovalRequest as RuntimeApprovalRequest } from '@megumi/shared/tool-contracts';
import { ApprovalCard } from '../../../entities/approval';
import { ToolCallStatusCard } from '../../../entities/tool-call';
import { useChatStore, type PendingToolCall } from '../../../entities/chat/store';
import { useRunStore } from '../../../entities/run/store';
import { useToolCallStore } from '../../../entities/tool-call/store';
import { useApprovalStore as useRuntimeApprovalStore } from '../../../entities/approval/store';
import { useApprovalStore } from '../../approvals/store';

function labelForRunStatus(status: string): string {
  if (status === 'running') return 'Running session message';
  if (status === 'completed') return 'Completed session message';
  if (status === 'failed') return 'Failed session message';
  if (status === 'cancelled') return 'Cancelled session message';
  return 'Session message';
}

function toPanelToolCall(toolCall: ToolCall): PendingToolCall {
  const status: PendingToolCall['status'] =
    toolCall.status === 'succeeded'
      ? 'completed'
      : toolCall.status === 'failed' || toolCall.status === 'denied'
        ? 'failed'
        : 'executing';

  return {
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    args: {
      summary: toolCall.inputPreview.summary,
      targets: toolCall.inputPreview.targets.map((target) => target.label).join(', '),
    },
    status,
    error: toolCall.error?.message,
  };
}

function toPanelApprovalRequest(request: RuntimeApprovalRequest) {
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    arguments: {
      action: request.preview.action,
      targets: request.preview.targets,
      riskLevel: request.riskLevel,
      requestedScope: request.requestedScope,
    },
    displayText: request.summary,
  };
}

export function TasksPanelTab() {
  const activeRunId = useRunStore((state) => state.activeRunId);
  const runs = useRunStore((state) => state.runs);
  const activeRun = activeRunId ? runs[activeRunId] : null;
  const toolCallsById = useToolCallStore((state) => state.toolCallsById);
  const approvalRequestsById = useRuntimeApprovalStore((state) => state.approvalRequestsById);
  const pendingToolCalls = useChatStore((state) => state.pendingToolCalls);
  const pendingApproval = useApprovalStore((state) => state.pending);
  const resolveApproval = useApprovalStore((state) => state.resolve);
  const setPendingApproval = useApprovalStore((state) => state.setPending);
  const runtimeToolCalls = useMemo(() => {
    if (!activeRunId) return [];

    return Object.values(toolCallsById)
      .filter((toolCall) => toolCall.runId === activeRunId)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  }, [activeRunId, toolCallsById]);
  const runtimeApprovals = useMemo(() => {
    if (!activeRunId) return [];

    return Object.values(approvalRequestsById)
      .filter((request) => request.runId === activeRunId && request.status === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, [activeRunId, approvalRequestsById]);
  const hasTasks =
    Boolean(activeRun) ||
    pendingToolCalls.length > 0 ||
    runtimeToolCalls.length > 0 ||
    runtimeApprovals.length > 0 ||
    Boolean(pendingApproval);

  function resolvePendingApproval(approved: boolean) {
    resolveApproval?.(approved);
    setPendingApproval(null);
  }

  if (!hasTasks) {
    return <p className="text-sm text-[var(--color-text-muted)]">No active tasks</p>;
  }

  return (
    <div className="space-y-3">
      {activeRun ? (
        <section className="space-y-2" aria-label="Session tasks">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Session tasks
          </h3>
          <article className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {labelForRunStatus(activeRun.status)}
              </p>
              <span className="text-xs text-[var(--color-text-muted)]">{activeRun.status}</span>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{activeRun.runId}</p>
          </article>
        </section>
      ) : null}

      {pendingApproval ? (
        <ApprovalCard
          request={pendingApproval}
          onApprove={() => resolvePendingApproval(true)}
          onDeny={() => resolvePendingApproval(false)}
        />
      ) : null}

      {runtimeApprovals.length > 0 ? (
        <section className="space-y-2" aria-label="Runtime approvals">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Runtime approvals
          </h3>
          {runtimeApprovals.map((approval) => (
            <ApprovalCard
              key={approval.approvalRequestId}
              request={toPanelApprovalRequest(approval)}
              onApprove={() => undefined}
              onDeny={() => undefined}
            />
          ))}
        </section>
      ) : null}

      {pendingToolCalls.length > 0 ? (
        <section className="space-y-2" aria-label="Active tool calls">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Active tool calls
          </h3>
          {pendingToolCalls.map((toolCall) => (
            <ToolCallStatusCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </section>
      ) : null}

      {runtimeToolCalls.length > 0 ? (
        <section className="space-y-2" aria-label="Runtime tool calls">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Runtime tool calls
          </h3>
          {runtimeToolCalls.map((toolCall) => (
            <ToolCallStatusCard key={toolCall.toolCallId} toolCall={toPanelToolCall(toolCall)} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
