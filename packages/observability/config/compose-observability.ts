/* Composes the complete Observability module while keeping host capabilities explicit. */
import { ObservabilityServiceImpl } from "../service/observability-service-impl";
import { ObservabilityQueryServiceImpl } from "../service/observability-query-service-impl";
import { ObservabilityRecordBuffer } from "../service/internal/observability-record-buffer";
import { LocalRecordReader } from "../service/internal/local-record-reader";
import { JsonlObservabilityStore } from "../storage/jsonl-observability-store";
import type { ObservabilityStorage } from "../storage/observability-storage";
export function composeObservability(options: {
  directoryPath: string;
  storage: ObservabilityStorage;
  appVersion: string;
  platform: string;
  arch: string;
  now?: () => Date;
  monotonicNowMs?: () => number;
  generateId?: () => string;
}) {
  const now = options.now ?? (() => new Date());
  const store = new JsonlObservabilityStore({
    directoryPath: options.directoryPath,
    storage: options.storage,
  });
  const buffer = new ObservabilityRecordBuffer(store);
  const service = new ObservabilityServiceImpl(
    buffer,
    {
      now,
      monotonicNowMs: options.monotonicNowMs ?? (() => performance.now()),
    },
    { nextId: options.generateId ?? (() => crypto.randomUUID()) },
  );
  const reader = new LocalRecordReader(options.directoryPath, options.storage);
  const queryService = new ObservabilityQueryServiceImpl(
    reader,
    () => buffer.getDroppedRecordCount(),
    () => ({
      appVersion: options.appVersion,
      platform: options.platform,
      arch: options.arch,
    }),
    now,
  );
  return { service, queryService, flush: () => service.flush() };
}
