/* Registers lazy diagnostics query IPC endpoints. */
import {
  ObservabilityQueryResultSchema,
  type ProductHostInterface,
} from "@megumi/product/host-interface";
import type { RuntimeLogger } from "@megumi/product/logging";
import {
  electronIpcMain,
  type DesktopIpcMain,
} from "../../adapters/electron-ipc-main-adapter";
import { IPC_CHANNELS } from "../channels";
import { createIpcRequestHandler } from "../create-request-handler";
import {
  ObservabilityBundleRequestSchema,
  ObservabilityGetRequestSchema,
  ObservabilityListRequestSchema,
} from "../schemas";
const mapError = () => ({
  code: "ipc_handler_failed" as const,
  message: "Diagnostics query failed.",
  severity: "error" as const,
  retryable: true,
  source: "main" as const,
});
export function registerObservabilityHandlers(
  service: {
    host: Pick<ProductHostInterface, "observability">;
    saveBundle?: (
      bundle: import("@megumi/observability").DiagnosticBundle,
    ) => Promise<object>;
  },
  options: { logger?: RuntimeLogger; ipcMain?: DesktopIpcMain } = {},
) {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(
    IPC_CHANNELS.observability.list,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.observability.list,
      requestSchema: ObservabilityListRequestSchema,
      responseSchema: ObservabilityQueryResultSchema,
      logger: options.logger,
      handle: (r) => service.host.observability.listRecentRunTraces(r.payload),
      mapError,
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.observability.get,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.observability.get,
      requestSchema: ObservabilityGetRequestSchema,
      responseSchema: ObservabilityQueryResultSchema,
      logger: options.logger,
      handle: (r) => service.host.observability.getRunTrace(r.payload),
      mapError,
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.observability.bundle,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.observability.bundle,
      requestSchema: ObservabilityBundleRequestSchema,
      responseSchema: ObservabilityQueryResultSchema,
      logger: options.logger,
      handle: async (r) => {
        const result = await service.host.observability.createDiagnosticBundle(
          r.payload,
        );
        return result.status === "created" && service.saveBundle
          ? service.saveBundle(result.bundle)
          : result;
      },
      mapError,
    }),
  );
}
