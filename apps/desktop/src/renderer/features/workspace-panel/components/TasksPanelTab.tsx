import { ApprovalCard } from '../../../entities/approval';
import { ToolCallStatusCard } from '../../../entities/tool-call';
import { useChatStore } from '../../../entities/chat/store';
import { WorkspaceTaskCard, useWorkspaceStateStore } from '../../../entities/workspace-state';
import { useApprovalStore } from '../../approvals/store';

export function TasksPanelTab() {
  const workspaceTasks = useWorkspaceStateStore((state) => state.tasks);
  const pendingToolCalls = useChatStore((state) => state.pendingToolCalls);
  const pendingApproval = useApprovalStore((state) => state.pending);
  const resolveApproval = useApprovalStore((state) => state.resolve);
  const setPendingApproval = useApprovalStore((state) => state.setPending);
  const hasTasks = workspaceTasks.length > 0 || pendingToolCalls.length > 0 || Boolean(pendingApproval);

  function resolvePendingApproval(approved: boolean) {
    resolveApproval?.(approved);
    setPendingApproval(null);
  }

  if (!hasTasks) {
    return <p className="text-sm text-[var(--color-text-muted)]">No active tasks</p>;
  }

  return (
    <div className="space-y-3">
      {workspaceTasks.length > 0 ? (
        <section className="space-y-2" aria-label="Session tasks">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            Session tasks
          </h3>
          {workspaceTasks.map((task) => (
            <WorkspaceTaskCard key={task.id} task={task} />
          ))}
        </section>
      ) : null}

      {pendingApproval ? (
        <ApprovalCard
          request={pendingApproval}
          onApprove={() => resolvePendingApproval(true)}
          onDeny={() => resolvePendingApproval(false)}
        />
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
    </div>
  );
}
