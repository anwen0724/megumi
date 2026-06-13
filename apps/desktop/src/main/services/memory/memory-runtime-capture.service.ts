// Orchestrates long-term memory capture after completed runs.
// The host validates and persists candidates; the extraction model only proposes JSON candidates.
import { createHash } from 'node:crypto';
import {
  buildMemoryExtractionPrompt,
  evaluateMemoryCaptureTrigger,
  parseMemoryExtractionOutput,
  resolveMemoryCandidate,
  validateMemoryCandidate,
} from '@megumi/memory';
import type {
  MemoryCaptureRunStatus,
  MemoryCaptureSignal,
  ValidatedMemoryCandidate,
} from '@megumi/memory';
import type {
  MemoryAuditLog,
  MemoryKind,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
} from '@megumi/shared/memory';
import type { ProviderId } from '@megumi/shared/provider';
import type { JsonObject, JsonValue } from '@megumi/shared/primitives';
import type { MemoryDiagnosticWriter } from './memory-diagnostic-writer.service';
import type { MemoryMarkdownSyncResult, MemoryMarkdownSyncService } from './memory-markdown-sync.service';

export interface MemoryExtractionModelClient {
  extractMemoryCandidates(input: {
    runId: string;
    sessionId: string;
    projectId?: string | null;
    providerId?: ProviderId | null;
    modelId?: string | null;
    prompt: ReturnType<typeof buildMemoryExtractionPrompt>;
    signal?: AbortSignal;
  }): Promise<
    | { ok: true; text: string }
    | { ok: false; reason: string }
  >;
}

export interface EvaluateRunCompletedMemoryCaptureInput {
  homePath: string;
  runId: string;
  sessionId: string;
  projectId?: string | null;
  providerId?: ProviderId | null;
  modelId?: string | null;
  runStatus: MemoryCaptureRunStatus;
  userText: string;
  assistantText?: string;
  toolActivitySummary?: string;
  signals?: MemoryCaptureSignal[];
  memoryEnabled?: boolean;
  hasProject?: boolean;
  lastCaptureAt?: string | null;
  cooldownMs?: number;
  signal?: AbortSignal;
}

export interface MemoryRuntimeCaptureRepository {
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
  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog;
}

export interface MemoryRuntimeCaptureOptions {
  repository: MemoryRuntimeCaptureRepository;
  markdownSync: Pick<MemoryMarkdownSyncService, 'exportAfterMemoryWrite'>;
  diagnostics: MemoryDiagnosticWriter;
  extractionClient?: MemoryExtractionModelClient;
  clock: { now(): string };
  ids: {
    memoryId(): string;
    auditId(): string;
  };
}

export type MemoryRuntimeCaptureResult =
  | { status: 'captured'; savedMemoryIds: string[] }
  | { status: 'skipped'; reason: string }
  | { status: 'degraded'; reason: string; savedMemoryIds?: string[] };

type AffectedScope = { scope: MemoryScope; projectId?: string | null };

export class MemoryRuntimeCaptureService {
  constructor(private readonly options: MemoryRuntimeCaptureOptions) {}

  async evaluateRunCompletedCapture(input: EvaluateRunCompletedMemoryCaptureInput): Promise<MemoryRuntimeCaptureResult> {
    const now = this.options.clock.now();
    let degradedReason: string | null = null;
    const captureAudit = this.saveAudit({
      operation: 'capture_evaluated',
      targetKind: 'memory',
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      reason: input.runStatus,
      metadata: {
        runStatus: input.runStatus,
        signals: input.signals ?? [],
        hasProject: input.hasProject ?? Boolean(input.projectId),
        userHash: hashText(input.userText).slice(0, 16),
        assistantHash: input.assistantText ? hashText(input.assistantText).slice(0, 16) : null,
      },
    });
    if (!captureAudit.ok) {
      degradedReason = 'audit_write_failed';
      await this.writeDiagnostic(input, 'audit_write_failed', 'warning', 'audit_write_failed', {
        message: captureAudit.message,
      });
    }

    if (input.memoryEnabled === false) {
      if (!this.saveExtractionSkipped(input, 'memory_disabled').ok) {
        degradedReason ??= 'audit_write_failed';
      }
      if (degradedReason) {
        return { status: 'degraded', reason: degradedReason };
      }
      return { status: 'skipped', reason: 'memory_disabled' };
    }

    const trigger = evaluateMemoryCaptureTrigger({
      runStatus: input.runStatus,
      memoryEnabled: true,
      hasProject: input.hasProject ?? Boolean(input.projectId),
      userText: input.userText,
      assistantFinalText: input.assistantText ?? null,
      toolActivity: {
        hasStableProjectFact: input.signals?.includes('stable_project_fact') ?? false,
        changedSourceOfTruthDocs: input.signals?.includes('source_of_truth_doc_changed') ? ['source-of-truth'] : [],
      },
      conversationMarkers: {
        hasRecentProposal: input.signals?.includes('confirmed_decision') ?? false,
      },
      now,
      lastCaptureAt: input.lastCaptureAt,
      cooldownMs: input.cooldownMs,
    });
    if (!trigger.shouldExtract) {
      if (!this.saveExtractionSkipped(input, trigger.reason, trigger.signals).ok) {
        degradedReason ??= 'audit_write_failed';
      }
      if (degradedReason) {
        return { status: 'degraded', reason: degradedReason };
      }
      return { status: 'skipped', reason: trigger.reason };
    }

    if (!this.options.extractionClient) {
      await this.saveExtractionFailed(input, 'missing_extraction_client');
      return { status: 'degraded', reason: 'missing_extraction_client' };
    }

    const prompt = buildMemoryExtractionPrompt({
      userText: input.userText,
      assistantFinalText: input.assistantText ?? '',
      signals: trigger.signals,
      projectId: input.projectId ?? null,
      toolActivitySummary: input.toolActivitySummary ?? null,
    });

    let extraction: Awaited<ReturnType<MemoryExtractionModelClient['extractMemoryCandidates']>>;
    try {
      extraction = await this.options.extractionClient.extractMemoryCandidates({
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId ?? null,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        prompt,
        signal: input.signal,
      });
    } catch (error) {
      await this.saveExtractionFailed(input, 'extraction_threw', {
        message: error instanceof Error ? error.message : String(error),
      });
      return { status: 'degraded', reason: 'extraction_threw' };
    }
    if (!extraction.ok) {
      await this.saveExtractionFailed(input, extraction.reason);
      return { status: 'degraded', reason: extraction.reason };
    }
    if (!extraction.text.trim()) {
      await this.saveExtractionFailed(input, 'empty_extraction_output');
      return { status: 'degraded', reason: 'empty_extraction_output' };
    }

    const parsed = parseMemoryExtractionOutput(extraction.text);
    if (!parsed.ok) {
      await this.saveExtractionFailed(input, parsed.reason, { diagnostic: parsed.diagnostic });
      return { status: 'degraded', reason: parsed.reason };
    }
    if (parsed.candidates.length === 0) {
      if (!this.saveExtractionSkipped(input, 'no_candidates', trigger.signals).ok) {
        degradedReason ??= 'audit_write_failed';
      }
      if (degradedReason) {
        return { status: 'degraded', reason: degradedReason };
      }
      return { status: 'skipped', reason: 'no_candidates' };
    }

    const savedMemoryIds = new Set<string>();
    const affectedScopes = new Map<string, AffectedScope>();

    for (const candidate of parsed.candidates) {
      const validation = validateMemoryCandidate({
        candidate,
        source: 'capture',
        now,
        projectId: input.projectId ?? null,
        sourceRunId: input.runId,
        sourceSessionId: input.sessionId,
      });
      if (!validation.accepted) {
        this.saveAudit({
          operation: 'candidate_rejected',
          targetKind: 'memory',
          runId: input.runId,
          sessionId: input.sessionId,
          projectId: input.projectId,
          reason: validation.reason,
          metadata: { diagnostic: validation.diagnostic },
        });
        await this.writeDiagnostic(input, 'candidate_rejected', 'warning', validation.reason, {
          normalizedText: typeof candidate === 'object' && candidate !== null && 'text' in candidate
            ? String(candidate.text)
            : validation.reason,
          redactedSnippet: validation.diagnostic,
        });
        continue;
      }

      try {
        const candidateRecord = toCandidateRecord({
          candidate: validation.candidate,
          memoryId: `candidate:${hashText(validation.candidate.normalizedText).slice(0, 16)}`,
        });
        const resolution = resolveMemoryCandidate({
          candidate: candidateRecord,
          existingActiveRecords: this.listActive(validation.candidate.scope, validation.candidate.projectId ?? null),
          now,
          createMemoryId: this.options.ids.memoryId,
        });
        if (resolution.action === 'conflict') {
          this.saveAudit({
            operation: 'conflict_detected',
            targetKind: 'memory',
            targetId: resolution.conflictingMemoryId,
            runId: input.runId,
            sessionId: input.sessionId,
            projectId: input.projectId,
            reason: resolution.reason,
            metadata: { candidateHash: hashText(candidateRecord.normalizedText).slice(0, 16) },
          });
          await this.writeDiagnostic(input, 'conflict_detected', 'warning', resolution.reason, {
            normalizedText: candidateRecord.normalizedText,
          });
          degradedReason ??= 'conflict_detected';
          continue;
        }

        const applied = this.applyResolution(resolution, input);
        for (const memory of applied) {
          savedMemoryIds.add(memory.memoryId);
          affectedScopes.set(scopeKey(memory.scope, memory.projectId ?? null), {
            scope: memory.scope,
            projectId: memory.projectId ?? null,
          });
        }
      } catch (error) {
        await this.writeDiagnostic(input, 'extraction_failed', 'error', 'memory_write_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        degradedReason ??= 'memory_write_failed';
      }
    }

    for (const affected of affectedScopes.values()) {
      let exportResult: MemoryMarkdownSyncResult;
      try {
        exportResult = await this.options.markdownSync.exportAfterMemoryWrite({
          homePath: input.homePath,
          scope: affected.scope,
          projectId: affected.projectId ?? null,
        });
      } catch (error) {
        await this.writeDiagnostic(input, 'markdown_export_failed', 'error', 'markdown_export_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        degradedReason ??= 'markdown_export_failed';
        continue;
      }
      if (exportResult.status === 'degraded') {
        degradedReason ??= exportResult.reason;
      }
    }

    if (degradedReason) {
      return { status: 'degraded', reason: degradedReason, savedMemoryIds: [...savedMemoryIds] };
    }
    if (savedMemoryIds.size === 0) {
      return { status: 'skipped', reason: 'no_accepted_candidates' };
    }
    return { status: 'captured', savedMemoryIds: [...savedMemoryIds] };
  }

  private listActive(scope: MemoryScope, projectId?: string | null): MemoryRecord[] {
    return this.options.repository.listMemories({
      scope,
      projectId: scope === 'project' ? projectId ?? null : null,
      status: 'active',
    });
  }

  private applyResolution(
    resolution: Exclude<ReturnType<typeof resolveMemoryCandidate>, { action: 'conflict' }>,
    input: EvaluateRunCompletedMemoryCaptureInput,
  ): MemoryRecord[] {
    if (resolution.action === 'create') {
      const saved = this.options.repository.saveMemory(resolution.newRecord);
      this.saveAudit({
        operation: 'memory_created',
        targetKind: 'memory',
        targetId: saved.memoryId,
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        reason: 'capture_create',
        metadata: { scope: saved.scope, kind: saved.kind },
      });
      return [saved];
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
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        reason: resolution.reason,
        metadata: { scope: saved.scope, kind: saved.kind },
      });
      return [saved];
    }

    const saved: MemoryRecord[] = [];
    const oldRecord = this.options.repository.getMemory(resolution.supersededMemoryId);
    if (oldRecord) {
      this.options.repository.saveMemory({ ...oldRecord, ...resolution.oldRecordPatch });
      this.saveAudit({
        operation: 'memory_superseded',
        targetKind: 'memory',
        targetId: oldRecord.memoryId,
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        reason: resolution.reason,
        metadata: { supersededById: resolution.newRecord.memoryId },
      });
    }
    const newRecord = this.options.repository.saveMemory(resolution.newRecord);
    this.saveAudit({
      operation: 'memory_created',
      targetKind: 'memory',
      targetId: newRecord.memoryId,
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      reason: 'capture_supersede',
      metadata: { scope: newRecord.scope, kind: newRecord.kind },
    });
    saved.push(newRecord);
    return saved;
  }

  private saveExtractionSkipped(
    input: EvaluateRunCompletedMemoryCaptureInput,
    reason: string,
    signals: MemoryCaptureSignal[] = input.signals ?? [],
  ): { ok: true } | { ok: false; message: string } {
    return this.saveAudit({
      operation: 'extraction_skipped',
      targetKind: 'memory',
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      reason,
      metadata: { signals },
    });
  }

  private async saveExtractionFailed(
    input: EvaluateRunCompletedMemoryCaptureInput,
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    this.saveAudit({
      operation: 'extraction_failed',
      targetKind: 'memory',
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      reason,
      metadata,
    });
    await this.writeDiagnostic(input, 'extraction_failed', 'error', reason, metadata);
  }

  private saveAudit(input: {
    operation: MemoryAuditLog['operation'];
    targetKind: MemoryAuditLog['targetKind'];
    targetId?: string | null;
    runId?: string | null;
    sessionId?: string | null;
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
        runId: input.runId ?? null,
        sessionId: input.sessionId ?? null,
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

  private async writeDiagnostic(
    input: EvaluateRunCompletedMemoryCaptureInput,
    operation: string,
    severity: 'info' | 'warning' | 'error',
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.options.diagnostics.write({
      homePath: input.homePath,
      operation,
      severity,
      createdAt: this.options.clock.now(),
      runId: input.runId,
      sessionId: input.sessionId,
      projectId: input.projectId ?? null,
      reason,
      metadata,
    });
  }
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

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function scopeKey(scope: MemoryScope, projectId?: string | null): string {
  return `${scope}:${projectId ?? ''}`;
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
