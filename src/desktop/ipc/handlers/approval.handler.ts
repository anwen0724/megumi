// Handles approval bridge operations by resuming the Agent Run through AppApi.
import type { DesktopIpcContext } from '../ipc-context';
import { createDesktopClientContext, mapRendererApprovalToAppResume } from '../../renderer-protocol/app-request.mapper';
import { mapAppResponseToRenderer } from '../../renderer-protocol/app-response.mapper';

export async function handleApprovalOperation(operation: string, payload: unknown, context: DesktopIpcContext): Promise<unknown> {
  if (operation !== 'approval.resolve') return undefined;
  const response = await context.appApi.resumeRun(
    mapRendererApprovalToAppResume(payload),
    createDesktopClientContext(),
  );
  return mapAppResponseToRenderer(response);
}
