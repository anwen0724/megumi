// Controller for session branch operations exposed to UI shells.
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type {
  SessionBranchDraftCancelData,
  SessionBranchDraftCreateData,
} from '@megumi/shared/ipc';
import type { SessionBranchServicePort } from '../../session';

export interface SessionBranchController {
  createDraft(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): { branchDraft: SessionBranchDraftCreateData['branchDraft']; events: Iterable<RuntimeEvent> };
  cancelDraft(input: {
    requestId: string;
    sessionId: string;
    branchMarkerId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    cancelled: boolean;
    reason?: SessionBranchDraftCancelData['reason'];
    events: Iterable<RuntimeEvent>;
  };
}

export function createSessionBranchController(
  branchService: SessionBranchServicePort,
): SessionBranchController {
  return {
    createDraft: (input) => branchService.createBranchDraft(input),
    cancelDraft: (input) => branchService.cancelBranchDraft(input),
  };
}
