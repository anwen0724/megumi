// Composes Desktop Main memory runtime services and the review-facing memory service.
import { MemoryRepository } from '@megumi/desktop/main/persistence/repos/memory.repo';
import {
  MemoryExtractionModelClientService,
  MemoryRecallRuntimeService,
  MemoryRuntimeCaptureService,
  createMemoryService,
} from '@megumi/coding-agent/memory';
import { MemoryDiagnosticWriter } from '../services/memory/memory-diagnostic-writer.service';
import { MemoryMarkdownSyncService } from '../services/memory/memory-markdown-sync.service';
import { createNodeMemoryRuntimeFileSystem } from '../services/memory/memory-runtime-file-system';
import type { ModelStepProviderService } from '../services/runtime/model-step-provider.service';
import type { RuntimeLogger } from '../services/runtime/runtime-logger.service';
import type { AppSettingsService } from '../services/settings/app-settings.service';

export interface ComposeMemoryRuntimeOptions {
  repository: MemoryRepository;
  modelStepProvider: ModelStepProviderService;
  appSettingsService: AppSettingsService;
  runtimeLogger: RuntimeLogger;
  megumiHomePath: string;
}

export function composeMemoryRuntime(options: ComposeMemoryRuntimeOptions) {
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

  if (options.appSettingsService.getResolvedSettings().memory.enabled) {
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
      emitRuntimeEvent: (event) => options.runtimeLogger.info('runtime.memory.event', {
        eventId: event.eventId,
        eventType: event.eventType,
        runId: event.runId,
        sessionId: event.sessionId,
      }),
    }),
  };
}
