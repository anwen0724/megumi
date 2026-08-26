/* Registers strict, lazy Trace diagnostics IPC endpoints. */
import {
  ObservabilityExportResultSchema,
  ObservabilityGetContentResultSchema,
  ObservabilityGetTraceResultSchema,
  ObservabilityHealthResultSchema,
  ObservabilityListResultSchema,
  ObservabilityRebuildResultSchema,
  type ProductHostInterface,
} from '@megumi/product-host/host';
import type { DesktopRuntimeLogger as ProductRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';
import { createIpcRequestHandler } from '../create-request-handler';
import {
  ObservabilityBundleRequestSchema,
  ObservabilityContentRequestSchema,
  ObservabilityGetRequestSchema,
  ObservabilityHealthRequestSchema,
  ObservabilityListRequestSchema,
  ObservabilityRebuildIndexRequestSchema,
} from '../schemas';

const mapError = () => ({
  code: 'ipc_handler_failed' as const,
  message: 'Diagnostics query failed.',
});

export function registerObservabilityHandlers(
  service: { host: Pick<ProductHostInterface, 'observability'> },
  options: { logger?: ProductRuntimeLogger; ipcMain?: DesktopIpcMain } = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(IPC_CHANNELS.observability.list, createIpcRequestHandler({
    channel: IPC_CHANNELS.observability.list,
    requestSchema: ObservabilityListRequestSchema,
    responseSchema: ObservabilityListResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.observability.listTraces(request.payload),
    mapError,
  }));
  ipcMain.handle(IPC_CHANNELS.observability.get, createIpcRequestHandler({
    channel: IPC_CHANNELS.observability.get,
    requestSchema: ObservabilityGetRequestSchema,
    responseSchema: ObservabilityGetTraceResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.observability.getTrace(request.payload),
    mapError,
  }));
  ipcMain.handle(IPC_CHANNELS.observability.content, createIpcRequestHandler({
    channel: IPC_CHANNELS.observability.content,
    requestSchema: ObservabilityContentRequestSchema,
    responseSchema: ObservabilityGetContentResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.observability.getContent(request.payload),
    mapError,
  }));
  ipcMain.handle(IPC_CHANNELS.observability.health, createIpcRequestHandler({
    channel: IPC_CHANNELS.observability.health,
    requestSchema: ObservabilityHealthRequestSchema,
    responseSchema: ObservabilityHealthResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.observability.getHealth(request.payload),
    mapError,
  }));
  ipcMain.handle(IPC_CHANNELS.observability.rebuildIndex, createIpcRequestHandler({
    channel: IPC_CHANNELS.observability.rebuildIndex,
    requestSchema: ObservabilityRebuildIndexRequestSchema,
    responseSchema: ObservabilityRebuildResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.observability.rebuildIndex(request.payload),
    mapError,
  }));
  ipcMain.handle(IPC_CHANNELS.observability.bundle, createIpcRequestHandler({
    channel: IPC_CHANNELS.observability.bundle,
    requestSchema: ObservabilityBundleRequestSchema,
    responseSchema: ObservabilityExportResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.observability.exportDiagnosticBundle(request.payload),
    mapError,
  }));
}
