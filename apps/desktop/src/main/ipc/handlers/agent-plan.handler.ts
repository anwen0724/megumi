import { ipcMain } from 'electron';
import type { ImplementationPlanArtifactRecord } from '@megumi/shared/agent-run-mode-contracts';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  AgentPlanByRunGetData,
  AgentPlanByRunGetPayload,
  AgentPlanStatusUpdateData,
  AgentPlanStatusUpdatePayload,
} from '@megumi/shared/ipc-schemas';
import {
  AgentPlanByRunGetRequestSchema,
  AgentPlanStatusUpdateRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { AgentRunModeService } from '../../services/agent-run-mode.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type AgentPlanHandlersService = Pick<
  AgentRunModeService,
  'getPlanByRun' | 'updatePlanStatus'
>;

export interface RegisterAgentPlanHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerAgentPlanHandlers(
  service: AgentPlanHandlersService,
  options: RegisterAgentPlanHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.agent.plan.byRunGet,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.plan.byRunGet,
      requestSchema: AgentPlanByRunGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentPlanByRunGetPayload, typeof IPC_CHANNELS.agent.plan.byRunGet>,
      ): AgentPlanByRunGetData => ({
        plan: service.getPlanByRun(request.payload.runId) as ImplementationPlanArtifactRecord | undefined,
      }),
      mapError: mapAgentPlanIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.plan.statusUpdate,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.plan.statusUpdate,
      requestSchema: AgentPlanStatusUpdateRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<
          AgentPlanStatusUpdatePayload,
          typeof IPC_CHANNELS.agent.plan.statusUpdate
        >,
      ): AgentPlanStatusUpdateData => ({
        plan: service.updatePlanStatus(request.payload),
      }),
      mapError: mapAgentPlanIpcError,
    }),
  );
}

function mapAgentPlanIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent plan service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
