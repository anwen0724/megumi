/*
 * Propagates Trace-local identity, ordering, and Span ancestry across async work.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { TraceCorrelation, TraceKind } from './trace-contract';

export interface ActiveTraceContext {
  readonly traceId: string;
  readonly traceKind: TraceKind;
  readonly correlation: TraceCorrelation;
  readonly currentSpanId?: string;
  readonly lifecycle: {
    sequence: number;
    diagnosticsDropped: boolean;
  };
}

/** Creates the process-local async context used by one Recorder instance. */
export function createTraceContext() {
  const storage = new AsyncLocalStorage<ActiveTraceContext>();
  return {
    current: (): ActiveTraceContext | undefined => storage.getStore(),
    run<T>(context: ActiveTraceContext, operation: () => T): T {
      return storage.run(context, operation);
    },
  };
}

export type TraceContext = ReturnType<typeof createTraceContext>;
