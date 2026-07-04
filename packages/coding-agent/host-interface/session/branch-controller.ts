// Controller for session branch operations exposed to UI shells.
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type {
  SessionBranchDraftCancelData,
  SessionBranchDraftCreateData,
} from '@megumi/shared/ipc';

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

export interface SessionBranchControllerServicePort {
  createBranchDraft(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): { branchDraft: SessionBranchDraftCreateData['branchDraft']; events: Iterable<RuntimeEvent> };
  cancelBranchDraft(input: {
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
  branchService: SessionBranchControllerServicePort,
): SessionBranchController {
  return {
    createDraft: (input) => branchService.createBranchDraft(input),
    cancelDraft: (input) => branchService.cancelBranchDraft(input),
  };
}
