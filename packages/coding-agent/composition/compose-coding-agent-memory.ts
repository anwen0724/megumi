// Composes Coding Agent memory runtime services and local memory adapters.
import type { MemoryRepository } from '../persistence/repos/memory.repo';
import {
  MemoryExtractionModelClientService,
  MemoryRecallRuntimeService,
  MemoryRuntimeCaptureService,
  createMemoryService,
} from '../memory';
import { MemoryDiagnosticWriter } from '../adapters/local/memory/memory-diagnostic-writer.service';
import { MemoryMarkdownSyncService } from '../adapters/local/memory/memory-markdown-sync.service';
import { createNodeMemoryRuntimeFileSystem } from '../adapters/local/memory/memory-runtime-file-system';
import type { AgentRunModelStepProvider } from '../run/run-contract';
import type { RuntimeLogger } from '../product-runtime';

export interface MemorySettingsProvider {
  isMemoryEnabled(): boolean;
}

export interface ComposeCodingAgentMemoryOptions {
  repository: MemoryRepository;
  modelStepProvider: AgentRunModelStepProvider;
  memorySettingsProvider: MemorySettingsProvider;
  runtimeLogger: RuntimeLogger;
  megumiHomePath: string;
}

export function composeCodingAgentMemory(options: ComposeCodingAgentMemoryOptions) {
  const fileSystem = createNodeMemoryRuntimeFileSystem();
  const diagnostics = new MemoryDiagnosticWriter({
    fileSystem,
    logger: options.runtimeLogger,
  });
  const markdownSync = new MemoryMarkdownSyncService({
    repository: options.repository,
    fileSystem,
    diagnostics,
    clock: { now: () => new Date().toISOString() },
    ids: {
      memoryId: () => `memory:${crypto.randomUUID()}`,
      auditId: () => `memory-audit:${crypto.randomUUID()}`,
    },
  });
  const extractionClient = new MemoryExtractionModelClientService({
    modelStepProvider: options.modelStepProvider,
    clock: { now: () => new Date().toISOString() },
    ids: {
      requestId: () => `memory-extraction-request:${crypto.randomUUID()}`,
      contextId: () => `memory-extraction-context:${crypto.randomUUID()}`,
      traceId: () => `memory-extraction-trace:${crypto.randomUUID()}`,
    },
  });
  const memoryRuntime = {
    memorySettingsProvider: options.memorySettingsProvider,
    markdownSyncService: markdownSync,
    recallService: new MemoryRecallRuntimeService({
      repository: options.repository,
      markdownSync,
      diagnostics,
      clock: { now: () => new Date().toISOString() },
      ids: {
        recallRequestId: () => `memory-recall-request:${crypto.randomUUID()}`,
        snapshotId: () => `memory-recall-snapshot:${crypto.randomUUID()}`,
        accessLogId: () => `memory-access:${crypto.randomUUID()}`,
        auditId: () => `memory-audit:${crypto.randomUUID()}`,
      },
    }),
    captureService: new MemoryRuntimeCaptureService({
      repository: options.repository,
      markdownSync,
      diagnostics,
      extractionClient,
      clock: { now: () => new Date().toISOString() },
      ids: {
        memoryId: () => `memory:${crypto.randomUUID()}`,
        auditId: () => `memory-audit:${crypto.randomUUID()}`,
      },
    }),
  };

  if (options.memorySettingsProvider.isMemoryEnabled()) {
    void memoryRuntime.markdownSyncService.syncUserMirrorOnAppStart({
      homePath: options.megumiHomePath,
    }).catch((error) => {
      options.runtimeLogger.warn('memory_user_markdown_startup_sync_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return {
    memoryRuntime,
    memoryService: createMemoryService({
      repository: options.repository,
      now: () => new Date().toISOString(),
      createId: (prefix) => `${prefix}:${crypto.randomUUID()}`,
      emitRuntimeEvent: (event) => options.runtimeLogger.info?.('runtime.memory.event', {
        eventId: event.eventId,
        eventType: event.eventType,
        runId: event.runId,
        sessionId: event.sessionId,
      }),
    }),
  };
}

export type MemoryRuntimeComposition = ReturnType<typeof composeCodingAgentMemory>;
