// Synchronizes editable Markdown memory mirrors with the authoritative SQLite store.
// Markdown is a user-editable mirror; SQLite remains the runtime source of truth.
import { createHash } from 'node:crypto';
import {
  parseMemoryMarkdown,
  renderMemoryMarkdown,
  resolveMemoryCandidate,
  validateMemoryCandidate,
} from '@megumi/memory';
import type { ValidatedMemoryCandidate } from '@megumi/memory';
import type {
  MemoryAuditLog,
  MemoryKind,
  MemoryMarkdownMirror,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
} from '@megumi/shared/memory';
import type { JsonObject, JsonValue } from '@megumi/shared/primitives';
import type { MemoryDiagnosticWriter } from './memory-diagnostic-writer.service';
import type { MemoryRuntimeFileSystem } from './memory-runtime-file-system';
import {
  resolveProjectMemoryMirrorTarget,
  resolveUserMemoryMirrorTarget,
} from './memory-runtime-paths';

export interface MemoryMarkdownSyncRepository {
  listMemories(filter?: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryKind;
    query?: string;
    limit?: number;
  }): MemoryRecord[];
  getMemory(memoryId: string): MemoryRecord | undefined;
  saveMemory(memory: MemoryRecord): MemoryRecord;
  saveMarkdownMirror(mirror: MemoryMarkdownMirror): void;
  getMarkdownMirror(mirrorId: string): MemoryMarkdownMirror | null;
  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog;
}

export interface MemoryMarkdownSyncOptions {
  repository: MemoryMarkdownSyncRepository;
  fileSystem: MemoryRuntimeFileSystem;
  diagnostics: MemoryDiagnosticWriter;
  clock: { now(): string };
  ids: {
    memoryId(): string;
    auditId(): string;
  };
}

export type MemoryMarkdownSyncResult =
  | { status: 'synced'; importedMemoryIds?: string[]; exportedMemoryIds?: string[] }
  | { status: 'skipped'; reason: string }
  | { status: 'degraded'; reason: string };

type MirrorInput = {
  homePath: string;
  scope: MemoryScope;
  projectId?: string | null;
};

export class MemoryMarkdownSyncService {
  constructor(private readonly options: MemoryMarkdownSyncOptions) {}

  async syncUserMirrorOnAppStart(input: { homePath: string }): Promise<MemoryMarkdownSyncResult> {
    return this.importMirror({ homePath: input.homePath, scope: 'user' });
  }

  async syncProjectMirrorOnProjectOpened(input: {
    homePath: string;
    projectId: string;
  }): Promise<MemoryMarkdownSyncResult> {
    return this.importMirror({ homePath: input.homePath, scope: 'project', projectId: input.projectId });
  }

  async syncBeforeRecall(input: {
    homePath: string;
    projectId?: string | null;
  }): Promise<MemoryMarkdownSyncResult> {
    const user = await this.importMirror({ homePath: input.homePath, scope: 'user' });
    const project = input.projectId
      ? await this.importMirror({ homePath: input.homePath, scope: 'project', projectId: input.projectId })
      : null;
    return combineResults([user, project].filter((result): result is MemoryMarkdownSyncResult => Boolean(result)));
  }

  async exportAfterMemoryWrite(input: {
    homePath: string;
    scope: MemoryScope;
    projectId?: string | null;
  }): Promise<MemoryMarkdownSyncResult> {
    return this.exportMirror(input);
  }

  async importMirror(input: MirrorInput): Promise<MemoryMarkdownSyncResult> {
    const target = resolveTarget(input);
    const now = this.options.clock.now();
    let read: Awaited<ReturnType<MemoryRuntimeFileSystem['readText']>>;
    try {
      read = await this.options.fileSystem.readText(target.filePath);
    } catch (error) {
      this.saveAudit({
        operation: 'markdown_import_failed',
        targetKind: 'markdown_mirror',
        targetId: target.mirrorId,
        projectId: input.projectId,
        reason: 'read_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
      });
      await this.writeDiagnostic({
        input,
        operation: 'markdown_import_failed',
        severity: 'error',
        targetId: target.mirrorId,
        reason: 'read_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
      });
      return { status: 'degraded', reason: 'read_failed' };
    }
    if (!read.ok) {
      if (read.reason === 'not_found') {
        const mirrorSaved = this.saveMirror({
          target,
          status: 'missing',
          now,
          metadata: {},
        });
        if (!mirrorSaved.ok) {
          await this.writeDiagnostic({
            input,
            operation: 'markdown_import_failed',
            severity: 'error',
            targetId: target.mirrorId,
            reason: 'mirror_state_write_failed',
            metadata: { message: mirrorSaved.message },
          });
          return { status: 'degraded', reason: 'mirror_state_write_failed' };
        }
        return { status: 'skipped', reason: 'mirror_missing' };
      }
      this.saveAudit({
        operation: 'markdown_import_failed',
        targetKind: 'markdown_mirror',
        targetId: target.mirrorId,
        projectId: input.projectId,
        reason: read.reason,
        metadata: { message: read.message },
      });
      await this.writeDiagnostic({
        input,
        operation: 'markdown_import_failed',
        severity: 'error',
        targetId: target.mirrorId,
        reason: read.reason,
        metadata: { message: read.message },
      });
      return { status: 'degraded', reason: read.reason };
    }

    try {
      const parsed = parseMemoryMarkdown({ scope: input.scope, markdown: read.content });
      this.saveAudit({
        operation: 'markdown_import_parsed',
        targetKind: 'markdown_mirror',
        targetId: target.mirrorId,
        projectId: input.projectId,
        reason: 'markdown_import',
        metadata: {
          scope: input.scope,
          entryCount: parsed.entries.length,
          diagnosticCount: parsed.diagnostics.length,
          contentHash: hashText(read.content),
        },
      });
      for (const diagnostic of parsed.diagnostics) {
        await this.writeDiagnostic({
          input,
          operation: 'markdown_import_failed',
          severity: 'warning',
          targetId: target.mirrorId,
          reason: diagnostic.reason,
          metadata: {
            reason: diagnostic.reason,
            ...(diagnostic.heading ? { heading: diagnostic.heading } : {}),
            ...(diagnostic.line ? { line: diagnostic.line } : {}),
          },
        });
      }

      const importedMemoryIds = new Set<string>();
      const parsedIds = new Set(parsed.entries.map((entry) => entry.memoryId).filter((id): id is string => Boolean(id)));
      let hasConflict = false;
      let activeRecords = this.listActive(input);

      for (const entry of parsed.entries) {
        const validation = validateMemoryCandidate({
          candidate: {
            scope: input.scope,
            kind: entry.kind,
            text: entry.text,
            confidence: 1,
            evidence: { source: 'source_file' },
          },
          source: 'markdown_import',
          now,
          projectId: input.scope === 'project' ? input.projectId ?? null : null,
        });
        if (!validation.accepted) {
          this.saveAudit({
            operation: 'candidate_rejected',
            targetKind: 'markdown_mirror',
            targetId: target.mirrorId,
            projectId: input.projectId,
            reason: validation.reason,
            metadata: { diagnostic: validation.diagnostic },
          });
          await this.writeDiagnostic({
            input,
            operation: 'candidate_rejected',
            severity: 'warning',
            targetId: target.mirrorId,
            reason: validation.reason,
            metadata: {
              normalizedText: entry.text,
              redactedSnippet: validation.diagnostic,
            },
          });
          continue;
        }
        this.saveAudit({
          operation: 'candidate_imported',
          targetKind: 'candidate',
          targetId: entry.memoryId ?? `markdown:${hashText(validation.candidate.normalizedText).slice(0, 16)}`,
          projectId: input.projectId,
          reason: 'markdown_import',
          metadata: {
            scope: validation.candidate.scope,
            kind: validation.candidate.kind,
            candidateHash: hashText(validation.candidate.normalizedText),
            hasMemoryId: Boolean(entry.memoryId),
          },
        });

        if (entry.memoryId) {
          const current = this.options.repository.getMemory(entry.memoryId);
          if (current && current.scope === input.scope && (current.projectId ?? null) === (target.projectId ?? null)) {
            const candidateRecord = toCandidateRecord({
              candidate: validation.candidate,
              memoryId: current.memoryId,
            });
            const resolution = resolveMemoryCandidate({
              candidate: candidateRecord,
              existingActiveRecords: activeRecords.filter((record) => record.memoryId !== current.memoryId),
              now,
              createMemoryId: () => current.memoryId,
            });
            if (resolution.action === 'conflict') {
              hasConflict = true;
              this.saveAudit({
                operation: 'conflict_detected',
                targetKind: 'memory',
                targetId: resolution.conflictingMemoryId,
                projectId: input.projectId,
                reason: resolution.reason,
                metadata: { candidateHash: hashText(candidateRecord.normalizedText) },
              });
              await this.writeDiagnostic({
                input,
                operation: 'conflict_detected',
                severity: 'warning',
                targetId: resolution.conflictingMemoryId,
                reason: resolution.reason,
                metadata: { normalizedText: candidateRecord.normalizedText },
              });
              continue;
            }
            const applied = this.applyIdUpdateResolution({
              resolution,
              current,
              candidate: validation.candidate,
              projectId: input.projectId ?? null,
              now,
            });
            for (const memoryId of applied) {
              importedMemoryIds.add(memoryId);
            }
            activeRecords = this.listActive(input);
          }
          continue;
        }

        const candidateRecord = toCandidateRecord({
          candidate: validation.candidate,
          memoryId: `candidate:${hashText(validation.candidate.normalizedText).slice(0, 16)}`,
        });
        const resolution = resolveMemoryCandidate({
          candidate: candidateRecord,
          existingActiveRecords: activeRecords,
          now,
          createMemoryId: this.options.ids.memoryId,
        });
        if (resolution.action === 'conflict') {
          hasConflict = true;
          this.saveAudit({
            operation: 'conflict_detected',
            targetKind: 'memory',
            targetId: resolution.conflictingMemoryId,
            projectId: input.projectId,
            reason: resolution.reason,
            metadata: { candidateHash: hashText(candidateRecord.normalizedText) },
          });
          await this.writeDiagnostic({
            input,
            operation: 'conflict_detected',
            severity: 'warning',
            targetId: resolution.conflictingMemoryId,
            reason: resolution.reason,
            metadata: { normalizedText: candidateRecord.normalizedText },
          });
          continue;
        }
        const applied = this.applyResolution(resolution, input.projectId ?? null);
        for (const memoryId of applied) {
          importedMemoryIds.add(memoryId);
        }
        activeRecords = this.listActive(input);
      }

      for (const memoryId of exportedIdsFromMirror(this.options.repository.getMarkdownMirror(target.mirrorId))) {
        if (!parsedIds.has(memoryId)) {
          const current = this.options.repository.getMemory(memoryId);
          if (current?.status === 'active' && current.scope === input.scope && (current.projectId ?? null) === (target.projectId ?? null)) {
            this.options.repository.saveMemory({
              ...current,
              status: 'deleted',
              deletedAt: now,
              updatedAt: now,
            });
            this.saveAudit({
              operation: 'memory_deleted',
              targetKind: 'memory',
              targetId: memoryId,
              projectId: input.projectId,
              reason: 'markdown_entry_removed',
              metadata: { scope: current.scope, kind: current.kind },
            });
          }
        }
      }

      if (hasConflict) {
        const mirrorSaved = this.saveMirror({
          target,
          status: 'conflict',
          now,
          lastImportedAt: now,
          metadata: { conflictDetectedAt: now },
        });
        if (!mirrorSaved.ok) {
          await this.writeDiagnostic({
            input,
            operation: 'markdown_import_failed',
            severity: 'error',
            targetId: target.mirrorId,
            reason: 'mirror_state_write_failed',
            metadata: { message: mirrorSaved.message },
          });
          return { status: 'degraded', reason: 'mirror_state_write_failed' };
        }
        return { status: 'degraded', reason: 'conflict_detected' };
      }

      const exportResult = await this.exportMirror(input);
      if (exportResult.status === 'synced') {
        return { ...exportResult, importedMemoryIds: [...importedMemoryIds] };
      }
      return exportResult;
    } catch (error) {
      this.saveAudit({
        operation: 'markdown_import_failed',
        targetKind: 'markdown_mirror',
        targetId: target.mirrorId,
        projectId: input.projectId,
        reason: 'import_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
      });
      await this.writeDiagnostic({
        input,
        operation: 'markdown_import_failed',
        severity: 'error',
        targetId: target.mirrorId,
        reason: 'import_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
      });
      return { status: 'degraded', reason: 'import_failed' };
    }
  }

  async exportMirror(input: MirrorInput): Promise<MemoryMarkdownSyncResult> {
    const target = resolveTarget(input);
    const now = this.options.clock.now();
    let records: MemoryRecord[];
    try {
      records = this.listActive(input);
    } catch (error) {
      await this.writeDiagnostic({
        input,
        operation: 'markdown_export_failed',
        severity: 'error',
        targetId: target.mirrorId,
        reason: 'read_active_memories_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
      });
      return { status: 'degraded', reason: 'read_active_memories_failed' };
    }
    const markdown = renderMemoryMarkdown({ title: target.title, records });
    const exportedMemoryIds = orderedExportedIds(records);
    let result: Awaited<ReturnType<MemoryRuntimeFileSystem['writeTextAtomic']>>;
    try {
      result = await this.options.fileSystem.writeTextAtomic(target.filePath, markdown);
    } catch (error) {
      await this.writeDiagnostic({
        input,
        operation: 'markdown_export_failed',
        severity: 'error',
        targetId: target.mirrorId,
        reason: 'write_failed',
        metadata: { message: error instanceof Error ? error.message : String(error) },
      });
      const mirrorSaved = this.saveMirror({
        target,
        status: 'dirty',
        now,
        lastError: error instanceof Error ? error.message : String(error),
        metadata: { exportedMemoryIds },
      });
      if (!mirrorSaved.ok) {
        await this.writeDiagnostic({
          input,
          operation: 'markdown_export_failed',
          severity: 'error',
          targetId: target.mirrorId,
          reason: 'mirror_state_write_failed',
          metadata: { message: mirrorSaved.message },
        });
      }
      return { status: 'degraded', reason: 'write_failed' };
    }
    if (!result.ok) {
      await this.writeDiagnostic({
        input,
        operation: 'markdown_export_failed',
        severity: 'error',
        targetId: target.mirrorId,
        reason: result.reason,
        metadata: { message: result.message },
      });
      this.saveMirror({
        target,
        status: 'dirty',
        now,
        lastError: result.message,
        metadata: { exportedMemoryIds },
      });
      return { status: 'degraded', reason: result.reason };
    }

    const mirrorSaved = this.saveMirror({
      target,
      status: 'synced',
      now,
      lastExportedAt: now,
      contentHash: hashText(markdown).slice(0, 32),
      metadata: { exportedMemoryIds },
    });
    if (!mirrorSaved.ok) {
      await this.writeDiagnostic({
        input,
        operation: 'markdown_export_failed',
        severity: 'error',
        targetId: target.mirrorId,
        reason: 'mirror_state_write_failed',
        metadata: { message: mirrorSaved.message },
      });
      return { status: 'degraded', reason: 'mirror_state_write_failed' };
    }
    return { status: 'synced', exportedMemoryIds };
  }

  private listActive(input: MirrorInput): MemoryRecord[] {
    return this.options.repository.listMemories({
      scope: input.scope,
      projectId: input.scope === 'project' ? input.projectId ?? null : null,
      status: 'active',
    });
  }

  private applyResolution(
    resolution: Exclude<ReturnType<typeof resolveMemoryCandidate>, { action: 'conflict' }>,
    projectId: string | null,
  ): string[] {
    if (resolution.action === 'create') {
      const saved = this.options.repository.saveMemory(resolution.newRecord);
      this.saveAudit({
        operation: 'memory_created',
        targetKind: 'memory',
        targetId: saved.memoryId,
        projectId,
        reason: 'markdown_import_create',
        metadata: { scope: saved.scope, kind: saved.kind },
      });
      return [saved.memoryId];
    }
    if (resolution.action === 'update_existing') {
      const current = this.options.repository.getMemory(resolution.targetMemoryId);
      if (!current) {
        return [];
      }
      const saved = this.options.repository.saveMemory({ ...current, ...resolution.recordPatch });
      this.saveAudit({
        operation: 'memory_updated',
        targetKind: 'memory',
        targetId: saved.memoryId,
        projectId,
        reason: resolution.reason,
        metadata: { scope: saved.scope, kind: saved.kind },
      });
      return [saved.memoryId];
    }
    const oldRecord = this.options.repository.getMemory(resolution.supersededMemoryId);
    if (oldRecord) {
      this.options.repository.saveMemory({ ...oldRecord, ...resolution.oldRecordPatch });
      this.saveAudit({
        operation: 'memory_superseded',
        targetKind: 'memory',
        targetId: oldRecord.memoryId,
        projectId,
        reason: resolution.reason,
        metadata: { supersededById: resolution.newRecord.memoryId },
      });
    }
    const saved = this.options.repository.saveMemory(resolution.newRecord);
    this.saveAudit({
      operation: 'memory_created',
      targetKind: 'memory',
      targetId: saved.memoryId,
      projectId,
      reason: 'markdown_import_supersede',
      metadata: { scope: saved.scope, kind: saved.kind },
    });
    return [saved.memoryId];
  }

  private applyIdUpdateResolution(input: {
    resolution: Exclude<ReturnType<typeof resolveMemoryCandidate>, { action: 'conflict' }>;
    current: MemoryRecord;
    candidate: ValidatedMemoryCandidate;
    projectId: string | null;
    now: string;
  }): string[] {
    if (input.resolution.action === 'create') {
      const updated = this.options.repository.saveMemory(toUpdatedCurrentRecord(input.current, input.candidate, input.now));
      this.saveAudit({
        operation: 'memory_updated',
        targetKind: 'memory',
        targetId: updated.memoryId,
        projectId: input.projectId,
        reason: 'markdown_id_update',
        metadata: { kind: updated.kind, scope: updated.scope },
      });
      return [updated.memoryId];
    }

    if (input.resolution.action === 'update_existing') {
      const target = this.options.repository.getMemory(input.resolution.targetMemoryId);
      const affected: string[] = [];
      if (target) {
        const updatedTarget = this.options.repository.saveMemory({
          ...target,
          ...input.resolution.recordPatch,
        });
        affected.push(updatedTarget.memoryId);
        this.saveAudit({
          operation: 'memory_updated',
          targetKind: 'memory',
          targetId: updatedTarget.memoryId,
          projectId: input.projectId,
          reason: input.resolution.reason,
          metadata: { scope: updatedTarget.scope, kind: updatedTarget.kind },
        });
      }

      // An id-based edit that dedupes into another active record is a merge, not a user deletion:
      // keep history by superseding the edited anchor record instead of leaving duplicate active memory.
      const supersededCurrent = this.options.repository.saveMemory({
        ...input.current,
        status: 'superseded',
        supersededById: input.resolution.targetMemoryId,
        updatedAt: input.now,
      });
      affected.push(supersededCurrent.memoryId);
      this.saveAudit({
        operation: 'memory_superseded',
        targetKind: 'memory',
        targetId: supersededCurrent.memoryId,
        projectId: input.projectId,
        reason: 'markdown_id_deduped_into_existing',
        metadata: { supersededById: input.resolution.targetMemoryId },
      });
      return affected;
    }

    const affected: string[] = [];
    const oldRecord = this.options.repository.getMemory(input.resolution.supersededMemoryId);
    if (oldRecord) {
      const supersededOld = this.options.repository.saveMemory({
        ...oldRecord,
        ...input.resolution.oldRecordPatch,
        supersededById: input.current.memoryId,
      });
      affected.push(supersededOld.memoryId);
      this.saveAudit({
        operation: 'memory_superseded',
        targetKind: 'memory',
        targetId: supersededOld.memoryId,
        projectId: input.projectId,
        reason: input.resolution.reason,
        metadata: { supersededById: input.current.memoryId },
      });
    }

    const updatedCurrent = this.options.repository.saveMemory(toUpdatedCurrentRecord(input.current, input.candidate, input.now));
    affected.push(updatedCurrent.memoryId);
    this.saveAudit({
      operation: 'memory_updated',
      targetKind: 'memory',
      targetId: updatedCurrent.memoryId,
      projectId: input.projectId,
      reason: 'markdown_id_supersedes_existing',
      metadata: { scope: updatedCurrent.scope, kind: updatedCurrent.kind },
    });
    return affected;
  }

  private saveAudit(input: {
    operation: MemoryAuditLog['operation'];
    targetKind: MemoryAuditLog['targetKind'];
    targetId?: string | null;
    projectId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): { ok: true } | { ok: false; message: string } {
    try {
      this.options.repository.saveAuditLog({
        auditId: this.options.ids.auditId(),
        operation: input.operation,
        targetKind: input.targetKind,
        targetId: input.targetId ?? null,
        projectId: input.projectId ?? null,
        actorKind: 'host',
        reason: input.reason ?? null,
        beforeState: null,
        afterState: null,
        createdAt: this.options.clock.now(),
        metadata: sanitizeAuditMetadata(input.metadata ?? {}),
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private saveMirror(input: {
    target: ReturnType<typeof resolveTarget>;
    status: MemoryMarkdownMirror['status'];
    now: string;
    lastImportedAt?: string | null;
    lastExportedAt?: string | null;
    contentHash?: string | null;
    lastError?: string | null;
    metadata: JsonObject;
  }): { ok: true } | { ok: false; message: string } {
    try {
      this.options.repository.saveMarkdownMirror({
        mirrorId: input.target.mirrorId,
        scope: input.target.scope,
        projectId: input.target.projectId ?? null,
        filePath: input.target.filePath,
        status: input.status,
        lastImportedAt: input.lastImportedAt ?? null,
        lastExportedAt: input.lastExportedAt ?? null,
        contentHash: input.contentHash ?? null,
        lastError: input.lastError ?? null,
        metadata: input.metadata,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async writeDiagnostic(input: {
    input: MirrorInput;
    operation: string;
    severity: 'info' | 'warning' | 'error';
    targetId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.options.diagnostics.write({
      homePath: input.input.homePath,
      operation: input.operation,
      severity: input.severity,
      createdAt: this.options.clock.now(),
      projectId: input.input.projectId ?? null,
      targetId: input.targetId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata,
    });
  }
}

function resolveTarget(input: MirrorInput) {
  if (input.scope === 'project') {
    if (!input.projectId) {
      throw new Error('Project memory mirror requires projectId.');
    }
    return resolveProjectMemoryMirrorTarget({ homePath: input.homePath, projectId: input.projectId });
  }
  return resolveUserMemoryMirrorTarget({ homePath: input.homePath });
}

function toCandidateRecord(input: {
  candidate: ValidatedMemoryCandidate;
  memoryId: string;
}): MemoryRecord {
  return {
    memoryId: input.memoryId,
    scope: input.candidate.scope,
    projectId: input.candidate.projectId ?? null,
    kind: input.candidate.kind,
    status: 'active',
    content: input.candidate.content,
    summary: input.candidate.summary,
    normalizedText: input.candidate.normalizedText,
    dedupeKey: input.candidate.dedupeKey,
    source: input.candidate.source,
    sourceRunId: input.candidate.sourceRunId ?? null,
    sourceSessionId: input.candidate.sourceSessionId ?? null,
    sourceMessageId: input.candidate.sourceMessageId ?? null,
    sourceToolCallId: input.candidate.sourceToolCallId ?? null,
    evidence: input.candidate.evidence,
    createdAt: input.candidate.createdAt,
    updatedAt: input.candidate.updatedAt,
    lastUsedAt: null,
    useCount: 0,
    metadata: {},
    confidence: input.candidate.confidence,
  };
}

function orderedExportedIds(records: MemoryRecord[]): string[] {
  const kindOrder: MemoryKind[] = ['preference', 'constraint', 'fact', 'decision'];
  return [...records]
    .sort((left, right) => {
      const kindDelta = kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
      return kindDelta || right.updatedAt.localeCompare(left.updatedAt);
    })
    .map((record) => record.memoryId);
}

function exportedIdsFromMirror(mirror: MemoryMarkdownMirror | null): string[] {
  const ids = mirror?.metadata.exportedMemoryIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function toUpdatedCurrentRecord(
  current: MemoryRecord,
  candidate: ValidatedMemoryCandidate,
  now: string,
): MemoryRecord {
  return {
    ...current,
    status: 'active',
    content: candidate.content,
    summary: candidate.summary,
    normalizedText: candidate.normalizedText,
    dedupeKey: candidate.dedupeKey,
    source: 'markdown_import',
    evidence: candidate.evidence,
    supersededById: null,
    updatedAt: now,
    deletedAt: null,
    confidence: candidate.confidence,
  };
}

function combineResults(results: MemoryMarkdownSyncResult[]): MemoryMarkdownSyncResult {
  const degraded = results.find((result) => result.status === 'degraded');
  if (degraded) {
    return degraded;
  }
  const synced = results.find((result) => result.status === 'synced');
  if (synced) {
    return synced;
  }
  return results[0] ?? { status: 'skipped', reason: 'no_mirror' };
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sanitizeAuditMetadata(value: Record<string, unknown>): JsonObject {
  return sanitizeAuditObject(value);
}

const FORBIDDEN_AUDIT_KEYS = new Set(['content', 'rawcontent', 'rawprompt', 'rawtooloutput', 'transcript']);

function sanitizeAuditObject(value: Record<string, unknown>): JsonObject {
  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUDIT_KEYS.has(normalizeMetadataKey(key))) {
      continue;
    }
    const jsonValue = toJsonValue(child);
    if (jsonValue !== undefined) {
      output[key] = jsonValue;
    }
  }
  return output;
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue).filter((item): item is JsonValue => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return sanitizeAuditObject(value as Record<string, unknown>);
  }
  return undefined;
}

function normalizeMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}
