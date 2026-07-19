/* Shared renderer contract for resolving an approval projected by Tool Activity. */
export type ToolApprovalResolvePayload =
  | { approvalRequestId: string; decision: 'approved'; optionId: string }
  | { approvalRequestId: string; decision: 'denied' };

export type ToolApprovalResolveResult =
  | { status: 'accepted' }
  | { status: 'failed'; message: string };
