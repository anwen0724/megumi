import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  AgentRecoverableRunListData,
  AgentRunCancelData,
  AgentRunCancelPayload,
  AgentRunResumeData,
  AgentRunResumePayload,
  AgentRunRetryData,
  AgentRunRetryPayload,
  RecoverableRunListData,
  RunCancelData,
  RunCancelPayload,
  RunResumeData,
  RunResumePayload,
  RunRetryData,
  RunRetryPayload,
} from '@megumi/shared/ipc-schemas';
import {
  AgentRecoverableRunListRequestSchema,
  AgentRunCancelRequestSchema,
  AgentRunResumeRequestSchema,
  AgentRunRetryRequestSchema,
  RecoverableRunListRequestSchema,
  RunCancelRequestSchema,
  RunResumeRequestSchema,
  RunRetryRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { AgentRecoveryService } from '../../services/agent-recovery.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export interface RegisterAgentRecoveryHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerAgentRecoveryHandlers(
  service: AgentRecoveryService,
  options: RegisterAgentRecoveryHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.recovery.recoverableRunsList,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.recovery.recoverableRunsList,
      requestSchema: RecoverableRunListRequestSchema,
      logger: options.logger,
      handle: (): RecoverableRunListData => ({ runs: service.listRecoverableRuns() }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.resume,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.recovery.resume,
      requestSchema: RunResumeRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunResumePayload, typeof IPC_CHANNELS.recovery.resume>,
      ): RunResumeData => ({ request: service.resumeRun(request.payload) }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.cancel,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.recovery.cancel,
      requestSchema: RunCancelRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunCancelPayload, typeof IPC_CHANNELS.recovery.cancel>,
      ): RunCancelData => ({ request: service.cancelRun(request.payload) }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.retry,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.recovery.retry,
      requestSchema: RunRetryRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunRetryPayload, typeof IPC_CHANNELS.recovery.retry>,
      ): RunRetryData => ({ request: service.retryRun(request.payload) }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.recovery.recoverableRunsList,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.recovery.recoverableRunsList,
      requestSchema: AgentRecoverableRunListRequestSchema,
      logger: options.logger,
      handle: (): AgentRecoverableRunListData => ({ runs: service.listRecoverableRuns() }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.recovery.resume,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.recovery.resume,
      requestSchema: AgentRunResumeRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentRunResumePayload, typeof IPC_CHANNELS.agent.recovery.resume>,
      ): AgentRunResumeData => ({ request: service.resumeRun(request.payload) }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.recovery.cancel,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.recovery.cancel,
      requestSchema: AgentRunCancelRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentRunCancelPayload, typeof IPC_CHANNELS.agent.recovery.cancel>,
      ): AgentRunCancelData => ({ request: service.cancelRun(request.payload) }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.recovery.retry,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.recovery.retry,
      requestSchema: AgentRunRetryRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentRunRetryPayload, typeof IPC_CHANNELS.agent.recovery.retry>,
      ): AgentRunRetryData => ({ request: service.retryRun(request.payload) }),
      mapError: mapAgentRecoveryIpcError,
    }),
  );
}

function mapAgentRecoveryIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent recovery service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
