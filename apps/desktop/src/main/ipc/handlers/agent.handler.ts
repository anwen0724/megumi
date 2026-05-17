import { ipcMain } from 'electron';
import type { AgentSession } from '@megumi/shared/agent-lifecycle-contracts';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type {
  AgentRunStartData,
  AgentRunStartPayload,
  AgentSessionCreateData,
  AgentSessionCreatePayload,
  AgentSessionListData,
} from '@megumi/shared/ipc-schemas';
import {
  AgentRunStartRequestSchema,
  AgentSessionCreateRequestSchema,
  AgentSessionListRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { SessionRunService } from '../../services/session-run.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import { forwardRuntimeEvents } from '../runtime-event-forwarder';

export type AgentHandlersService = Pick<SessionRunService, 'createSession' | 'listSessions' | 'startRun'>;

export interface RegisterAgentHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerAgentHandlers(
  service: AgentHandlersService,
  options: RegisterAgentHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.agent.session.create,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.session.create,
      requestSchema: AgentSessionCreateRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentSessionCreatePayload, typeof IPC_CHANNELS.agent.session.create>,
      ): AgentSessionCreateData => ({
        session: service.createSession(request.payload),
      }),
      mapError: mapAgentIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.session.list,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.session.list,
      requestSchema: AgentSessionListRequestSchema,
      logger: options.logger,
      handle: (): AgentSessionListData => ({
        sessions: service.listSessions() as AgentSession[],
      }),
      mapError: mapAgentIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.run.start,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.run.start,
      requestSchema: AgentRunStartRequestSchema,
      logger: options.logger,
      handle: async (
        request: RuntimeIpcRequest<AgentRunStartPayload, typeof IPC_CHANNELS.agent.run.start>,
        event,
      ): Promise<AgentRunStartData> => {
        const result = await service.startRun(request.payload);
        await forwardRuntimeEvents(event.sender, asAsyncRuntimeEvents(result.events), {
          logger: options.logger,
        });
        return { run: result.run };
      },
      mapError: mapAgentIpcError,
    }),
  );
}

function mapAgentIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent lifecycle service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}

async function* asAsyncRuntimeEvents(
  events: Iterable<RuntimeEvent> | AsyncIterable<RuntimeEvent>,
): AsyncIterable<RuntimeEvent> {
  for await (const event of events) {
    yield event;
  }
}
