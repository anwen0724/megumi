// Controller for permission approval operations exposed to UI shells.
import type { ApprovalResolveData, ApprovalResolvePayload } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolService } from '../../tools';

export interface ApprovalController {
  resolve(payload: ApprovalResolvePayload): { data: ApprovalResolveData; events?: AsyncIterable<RuntimeEvent> };
}

export function createApprovalController(
  toolService: Pick<ToolService, 'resolveApproval'>,
): ApprovalController {
  return {
    resolve(payload) {
      const response = toolService.resolveApproval(payload);
      return {
        data: { approval: response.approval },
        ...(response.events ? { events: response.events } : {}),
      };
    },
  };
}
