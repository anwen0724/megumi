/* Validates Memory management IPC and keeps production run state distinct from request errors. */
import { z } from 'zod';
import {
  MemoryRequestSchemas,
  MemoryResponseSchemas,
  type ApplicationOperations,
} from '@megumi/application/contracts';
import type { DesktopRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import {
  createRuntimeIpcRequestSchema,
  type BusinessIpcChannel,
  type RuntimeIpcRequest,
} from '../contracts';
import { RuntimeIpcErrorSchema } from '../errors';
import { IPC_CHANNELS } from '../channels';

export interface MemoryHandlersService {
  host: Pick<ApplicationOperations, 'memory'>;
}
interface MemoryHandlersOptions {
  logger?: DesktopRuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

/** Registers queries and accepted commands; no IPC request waits for generation to finish. */
export function registerMemoryHandlers(
  service: MemoryHandlersService,
  options: MemoryHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  const memory = service.host.memory;
  /** Converts only operation failures, then validates the serializable response once. */
  function register<Input, Output>(
    channel: BusinessIpcChannel,
    request: z.ZodType<RuntimeIpcRequest<Input>>,
    response: z.ZodType<Output>,
    handle: (payload: Input) => unknown,
  ) {
    ipcMain.handle(
      channel,
      createIpcRequestHandler({
        channel,
        requestSchema: request,
        responseSchema: response,
        // Parsing happens once below, after converting declared business rejections.
        responseValidation: 'off',
        logger: options.logger,
        handle(envelope) {
          const result = handle(envelope.payload);
          if (
            typeof result === 'object' &&
            result !== null &&
            'status' in result &&
            result.status === 'failed' &&
            'error' in result
          )
            throw result.error;
          return response.parse(result);
        },
        mapError(error) {
          const parsed = RuntimeIpcErrorSchema.safeParse(error);
          return parsed.success
            ? parsed.data
            : {
                code: 'ipc_handler_failed',
                message: 'Memory request failed.',
              };
        },
      }),
    );
  }
  register(
    IPC_CHANNELS.memory.getStatus,
    createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.getStatus, MemoryRequestSchemas.getStatus),
    MemoryResponseSchemas.getStatus,
    payload => memory.getStatus(),
  );
  register(
    IPC_CHANNELS.memory.startGeneration,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.startGeneration,
      MemoryRequestSchemas.startGeneration,
    ),
    MemoryResponseSchemas.startGeneration,
    payload => memory.startGeneration(payload),
  );
  register(
    IPC_CHANNELS.memory.getRun,
    createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.getRun, MemoryRequestSchemas.getRun),
    MemoryResponseSchemas.getRun,
    payload => memory.getRun(payload.runId) ?? { status: 'notFound' },
  );
  register(
    IPC_CHANNELS.memory.cancelRun,
    createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.cancelRun, MemoryRequestSchemas.cancelRun),
    MemoryResponseSchemas.cancelRun,
    payload => memory.cancelRun(payload),
  );
  register(
    IPC_CHANNELS.memory.listDocuments,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.listDocuments,
      MemoryRequestSchemas.listDocuments,
    ),
    MemoryResponseSchemas.listDocuments,
    payload => memory.listDocuments(payload),
  );
  register(
    IPC_CHANNELS.memory.readDocument,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.readDocument,
      MemoryRequestSchemas.readDocument,
    ),
    MemoryResponseSchemas.readDocument,
    payload => memory.readDocument(payload),
  );
  register(
    IPC_CHANNELS.memory.searchDocuments,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.searchDocuments,
      MemoryRequestSchemas.searchDocuments,
    ),
    MemoryResponseSchemas.searchDocuments,
    payload => memory.searchDocuments(payload),
  );
  register(
    IPC_CHANNELS.memory.updateDocument,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.updateDocument,
      MemoryRequestSchemas.updateDocument,
    ),
    MemoryResponseSchemas.updateDocument,
    payload => memory.updateDocument(payload),
  );
  register(
    IPC_CHANNELS.memory.listSources,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.listSources,
      MemoryRequestSchemas.listSources,
    ),
    MemoryResponseSchemas.listSources,
    payload => memory.listSources(payload),
  );
  register(
    IPC_CHANNELS.memory.readSource,
    createRuntimeIpcRequestSchema(IPC_CHANNELS.memory.readSource, MemoryRequestSchemas.readSource),
    MemoryResponseSchemas.readSource,
    payload => memory.readSource(payload),
  );
  register(
    IPC_CHANNELS.memory.setSourceEligibility,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.setSourceEligibility,
      MemoryRequestSchemas.setSourceEligibility,
    ),
    MemoryResponseSchemas.setSourceEligibility,
    payload => memory.setSourceEligibility(payload),
  );
  register(
    IPC_CHANNELS.memory.clearMemory,
    createRuntimeIpcRequestSchema(
      IPC_CHANNELS.memory.clearMemory,
      MemoryRequestSchemas.clearMemory,
    ),
    MemoryResponseSchemas.clearMemory,
    payload => memory.clearMemory(payload),
  );
}
