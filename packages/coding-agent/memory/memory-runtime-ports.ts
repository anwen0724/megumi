// Ports used by Coding Agent memory runtime services for host persistence and diagnostics.
import type { MemoryScope } from '@megumi/shared/memory';
import type { JsonObject } from '@megumi/shared/primitives';

export type MemoryMarkdownSyncResult =
  | { status: 'synced'; importedCount?: number; exportedCount?: number }
  | { status: 'skipped'; reason: string }
  | { status: 'noop'; reason?: string }
  | { status: 'degraded'; reason: string };

export interface MemoryMarkdownSyncBeforeRecallPort {
  syncBeforeRecall(input: { homePath: string; projectId?: string | null }): Promise<MemoryMarkdownSyncResult>;
}

export interface MemoryMarkdownExportPort {
  exportAfterMemoryWrite(input: {
    homePath: string;
    scope: MemoryScope;
    projectId?: string | null;
  }): Promise<MemoryMarkdownSyncResult>;
}

export interface MemoryProjectMirrorSyncPort {
  syncProjectMirrorOnProjectOpened(input: { homePath: string; projectId: string }): Promise<unknown>;
}

export interface MemoryDiagnosticWriterPort {
  write(input: {
    homePath: string;
    operation: string;
    severity: 'info' | 'warning' | 'error';
    createdAt: string;
    runId?: string | null;
    sessionId?: string | null;
    projectId?: string | null;
    targetId?: string | null;
    reason?: string | null;
    metadata?: JsonObject;
  }): Promise<void>;
}
