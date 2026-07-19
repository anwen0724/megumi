/* Selects pending approval controls from the canonical timeline without duplicating approval state. */
import type { TimelineMessage, ToolActivityItem } from '@megumi/product/runtime-timeline';

export function collectPendingApprovalActivities(messages: TimelineMessage[]): ToolActivityItem[] {
  const approvals: ToolActivityItem[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.blocks) {
      if (block.kind !== 'process_disclosure') continue;
      for (const item of block.items) {
        if (item.kind !== 'tool_activity' || item.status !== 'awaiting_approval' || !item.approval) continue;
        if (seen.has(item.approval.approvalRequestId)) continue;
        seen.add(item.approval.approvalRequestId);
        approvals.push(item);
      }
    }
  }

  return approvals;
}
