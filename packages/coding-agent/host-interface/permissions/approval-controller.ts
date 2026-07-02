// Controller for permission approval operations exposed to UI shells.
import type { ApprovalResolveData, ApprovalResolvePayload } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ApprovalResolutionPort } from './approval-resolution-service';

export interface ApprovalController {
  resolve(payload: ApprovalResolvePayload): { data: ApprovalResolveData; events?: AsyncIterable<RuntimeEvent> };
}

export function createApprovalController(resolver: ApprovalResolutionPort): ApprovalController {
  return {
    resolve(payload) {
      return resolver.resolve(payload);
    },
  };
}
