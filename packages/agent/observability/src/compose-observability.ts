/*
 * Composes the complete local Observability runtime and owns all diagnostic resource shutdown.
 */
import type { DatabaseConnection } from '@megumi/database';
import { createContentStore } from './content/content-store';
import { createRetentionCleaner, type RetentionCleaner } from './persistence/retention-cleaner';
import type { ObservabilityStorage } from './persistence/observability-storage';
import { createTraceIndex, type TraceIndex } from './persistence/trace-index';
import { createTraceJournal } from './persistence/trace-journal';
import { createTraceDiagnosticBundle } from './query/diagnostic-bundle';
import type { ObservabilityQueries } from './query/trace-query';
import { createTraceReader } from './query/trace-reader';
import {
  createObservabilityHealth,
  type ObservabilityHealth,
} from './runtime/observability-health';
import { createRuntimeLogger, type RuntimeLogger } from './runtime/runtime-logger';
import type { Observability } from './trace/observability';
import { createTraceContext } from './trace/trace-context';
import { createTraceRecorder } from './trace/trace-recorder';

export interface ComposeObservabilityOptions {
  readonly rootDirectory: string;
  readonly storage: ObservabilityStorage;
  readonly openIndexDatabase?: () => DatabaseConnection;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface ComposedObservability {
  readonly observability: Observability;
  readonly queries: ObservabilityQueries;
  readonly runtimeLogger: RuntimeLogger;
  readonly health: ObservabilityHealth;
  /** Drains accepted Trace and Runtime Log writes without touching business resources. */
  flush(): Promise<void>;
  /** Drains writers, stops retention, and closes the disposable Derived Index. */
  shutdown(): Promise<void>;
}

/** Creates a working local diagnostic runtime or a transparent no-op fallback. */
export function composeObservability(options: ComposeObservabilityOptions): ComposedObservability {
  try {
    return composeLocalObservability(options);
  } catch {
    return createNoopComposition();
  }
}

function composeLocalObservability(options: ComposeObservabilityOptions): ComposedObservability {
  const health = createObservabilityHealth();
  const context = createTraceContext();
  const contentStore = createContentStore({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
  });
  const indexResource = openDerivedIndex(options.openIndexDatabase, health);
  let retention: RetentionCleaner | undefined;
  const retentionPort = {
    ensureCapacity: (additionalBytes: number) => (
      retention?.ensureCapacity(additionalBytes) ?? Promise.resolve(true)
    ),
    maintain: () => retention?.maintain() ?? Promise.resolve({
      capacityAvailable: true,
      totalBytes: 0,
      deletedFiles: [],
    }),
  };
  const journal = createTraceJournal({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
    contentStore,
    health,
    retention: retentionPort,
  });
  const runtimeLogger = createRuntimeLogger({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
    context,
    health,
    ...(options.now ? { now: options.now } : {}),
    ...(options.createId ? { createId: options.createId } : {}),
    retention: retentionPort,
  });
  retention = createRetentionCleaner({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
    health,
    runtimeLogger,
    ...(indexResource.index ? { index: indexResource.index } : {}),
    activeFilePaths: () => new Set([
      ...optionalValue(journal.activeFilePath()),
      ...optionalValue(runtimeLogger.activeFilePath()),
    ]),
    protectedContentIds: () => journal.protectedContentIds(),
    ...(options.now ? { now: options.now } : {}),
  });
  const observability = createTraceRecorder({
    enqueue: journal.enqueue,
    context,
    health,
    ...(options.now ? { now: options.now } : {}),
    ...(options.createId ? { createId: options.createId } : {}),
  });
  const reader = createTraceReader({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
    contentStore,
    ...(indexResource.index ? { index: indexResource.index } : {}),
  });
  const queries: ObservabilityQueries = {
    ...reader,
    getHealth: () => health.snapshot(),
    async createDiagnosticBundle(traceId) {
      try {
        const trace = await reader.getTrace(traceId);
        return trace
          ? {
              status: 'created',
              bundle: await createTraceDiagnosticBundle({
                trace,
                readContent: reader.readContent,
                ...(options.now ? { now: options.now } : {}),
              }),
            }
          : { status: 'not_found' };
      } catch {
        return { status: 'failed' };
      }
    },
  };
  const startup = retention.startup();
  let shutdownPromise: Promise<void> | undefined;

  return {
    observability,
    queries,
    runtimeLogger,
    health,
    async flush() {
      await Promise.allSettled([journal.flush(), runtimeLogger.flush()]);
    },
    shutdown() {
      shutdownPromise ??= shutdownResources(
        startup,
        journal,
        runtimeLogger,
        retention,
        indexResource.database,
      );
      return shutdownPromise;
    },
  };
}

function openDerivedIndex(
  openDatabase: (() => DatabaseConnection) | undefined,
  health: ObservabilityHealth,
): { readonly database?: DatabaseConnection; readonly index?: TraceIndex } {
  if (!openDatabase) return {};
  let database: DatabaseConnection | undefined;
  try {
    database = openDatabase();
    const index = createTraceIndex({ database });
    index.initialize();
    return { database, index };
  } catch {
    health.recordIndexProjectionFailure();
    try {
      database?.close();
    } catch {
      // The streaming Reader remains available without the disposable Index.
    }
    return {};
  }
}

async function shutdownResources(
  startup: Promise<unknown>,
  journal: ReturnType<typeof createTraceJournal>,
  runtimeLogger: RuntimeLogger,
  retention: RetentionCleaner,
  database: DatabaseConnection | undefined,
): Promise<void> {
  await Promise.allSettled([startup, journal.shutdown(), runtimeLogger.shutdown()]);
  await Promise.allSettled([retention.shutdown()]);
  try {
    database?.close();
  } catch {
    // Derived Index close cannot change product shutdown settlement.
  }
}

function optionalValue<T>(value: T | undefined): readonly T[] {
  return value === undefined ? [] : [value];
}

function createNoopComposition(): ComposedObservability {
  const health = createObservabilityHealth();
  const observability: Observability = {
    withTrace: (_options, operation) => operation(),
    withSpan: (_options, operation) => operation(),
    recordContent: () => undefined,
    recordEvent: () => undefined,
    linkTrace: () => undefined,
  };
  const runtimeLogger: RuntimeLogger = {
    write: () => undefined,
    flush: async () => undefined,
    shutdown: async () => undefined,
    activeFilePath: () => undefined,
  };
  const queries: ObservabilityQueries = {
    listTraces: async () => [],
    getTrace: async () => undefined,
    readContent: async () => ({ status: 'missing' }),
    rebuildIndex: async () => false,
    getHealth: () => health.snapshot(),
    createDiagnosticBundle: async () => ({ status: 'not_found' }),
  };
  return {
    observability,
    queries,
    runtimeLogger,
    health,
    flush: async () => undefined,
    shutdown: async () => undefined,
  };
}
