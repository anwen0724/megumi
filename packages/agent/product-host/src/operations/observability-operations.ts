/* Exposes Observability queries and coordinates host-owned bundle persistence. */
import type { ObservabilityQueryService } from '@megumi/observability';
import {
  ObservabilityListPayloadSchema,
  ObservabilityRunPayloadSchema,
  type ObservabilityHost,
} from '../host/observability-host';
import type { DiagnosticBundleSaver } from '../host/capabilities/diagnostic-bundle-saver';

/** Creates the Product operations exposed through ObservabilityHost. */
export function createObservabilityOperations(
  request: {
    queries: ObservabilityQueryService;
    flush(): Promise<void>;
    save?: DiagnosticBundleSaver;
  },
): ObservabilityHost {
  return {
    listRecentRunTraces: (p) =>
      request.queries.listRecentRunTraces(ObservabilityListPayloadSchema.parse(p)),
    getRunTrace: (p) =>
      request.queries.getRunTrace(ObservabilityRunPayloadSchema.parse(p)),
    flush: () => request.flush(),
    exportDiagnosticBundle: async (p) => {
      const result = await request.queries.createDiagnosticBundle(
        ObservabilityRunPayloadSchema.parse(p),
      );
      if (result.status !== 'created') return result;
      return request.save
        ? request.save.save(result.bundle)
        : {
            status: 'failed',
            message: 'Diagnostic bundle save capability is unavailable.',
          };
    },
  };
}
