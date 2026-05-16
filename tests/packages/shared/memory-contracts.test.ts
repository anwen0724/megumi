import { describe, expect, it } from 'vitest';
import {
  MEMORY_ACCESS_KINDS,
  MEMORY_AUDIT_OPERATIONS,
  MEMORY_CANDIDATE_STATUSES,
  MEMORY_KINDS,
  MEMORY_RECORD_STATUSES,
  MEMORY_SCOPES,
  MEMORY_SOURCE_KINDS,
  MemoryAccessLogSchema,
  MemoryAuditLogSchema,
  MemoryCandidateSchema,
  MemoryPolicySchema,
  MemoryRecallRequestSchema,
  MemoryRecallResultSchema,
  MemoryRecordSchema,
  MemorySettingsSchema,
  MemorySourceRefSchema,
} from '@megumi/shared/memory-contracts';

const now = '2026-05-16T00:00:00.000Z';

describe('memory contracts', () => {
  it('defines stable scope kind status and governance vocabularies', () => {
    expect(MEMORY_SCOPES).toEqual(['user', 'workspace', 'project', 'session']);
    expect(MEMORY_KINDS).toEqual(['preference', 'project_fact', 'workflow', 'constraint', 'decision']);
    expect(MEMORY_CANDIDATE_STATUSES).toEqual(['proposed', 'accepted', 'rejected', 'archived']);
    expect(MEMORY_RECORD_STATUSES).toEqual(['active', 'archived', 'disabled', 'deleted']);
    expect(MEMORY_SOURCE_KINDS).toEqual([
      'message',
      'session',
      'run',
      'step',
      'runtime_event',
      'observation',
      'artifact',
      'tool_call',
      'manual',
      'host_context',
    ]);
    expect(MEMORY_ACCESS_KINDS).toEqual(['recalled', 'selected_for_context', 'viewed', 'exported']);
    expect(MEMORY_AUDIT_OPERATIONS).toContain('candidate_accepted');
    expect(MEMORY_AUDIT_OPERATIONS).toContain('memory_deleted');
  });

  it('parses a proposed candidate with safe source refs', () => {
    const candidate = MemoryCandidateSchema.parse({
      candidateId: 'memory-candidate:1',
      workspaceId: 'workspace:1',
      scope: 'workspace',
      kind: 'workflow',
      content: '项目大功能先写 spec，再写 00 brief，再写 implementation plans。',
      summary: '项目大功能采用 spec -> brief -> plans 流程。',
      sourceRefs: [
        {
          sourceRefId: 'memory-source:1',
          ownerId: 'memory-candidate:1',
          ownerKind: 'candidate',
          kind: 'message',
          refId: 'message:1',
          label: '用户确认的流程',
          excerptPreview: '先写 spec，再写 00 brief。',
          createdAt: now,
        },
      ],
      confidence: 0.9,
      riskLevel: 'low',
      status: 'proposed',
      proposedBy: 'agent',
      createdAt: now,
      metadata: { source: 'test' },
    });

    expect(candidate.status).toBe('proposed');
    expect(JSON.stringify(candidate)).not.toContain('raw full prompt');
  });

  it('parses records recall results access logs audit logs policy and settings', () => {
    const sourceRef = MemorySourceRefSchema.parse({
      sourceRefId: 'memory-source:2',
      ownerId: 'memory:1',
      ownerKind: 'memory',
      kind: 'artifact',
      refId: 'artifact:1',
      label: 'Review report',
      excerptPreview: '安全摘要',
      createdAt: now,
    });

    const record = MemoryRecordSchema.parse({
      memoryId: 'memory:1',
      workspaceId: 'workspace:1',
      scope: 'workspace',
      kind: 'constraint',
      content: 'Runtime IPC channel 必须位于 request.meta.channel。',
      summary: 'IPC channel 位置约束。',
      sourceRefs: [sourceRef],
      confidence: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
    });

    const request = MemoryRecallRequestSchema.parse({
      recallRequestId: 'memory-recall:1',
      sessionId: 'session:1',
      runId: 'run:1',
      workspaceId: 'workspace:1',
      query: 'ipc channel',
      scopes: ['workspace'],
      kinds: ['constraint'],
      limit: 5,
      budget: 500,
      createdAt: now,
    });

    const result = MemoryRecallResultSchema.parse({
      recallResultId: 'memory-recall-result:1',
      recallRequestId: request.recallRequestId,
      memoryId: record.memoryId,
      scope: record.scope,
      kind: record.kind,
      summary: record.summary,
      contentPreview: 'Runtime IPC channel 必须位于 request.meta.channel。',
      relevanceScore: 0.95,
      confidence: 1,
      sourceRefs: [sourceRef],
      recallReason: 'scope_match query_match',
      tokenEstimate: 12,
      selectedForContext: true,
      createdAt: now,
    });

    const access = MemoryAccessLogSchema.parse({
      accessLogId: 'memory-access:1',
      memoryId: record.memoryId,
      sessionId: 'session:1',
      runId: 'run:1',
      recallRequestId: request.recallRequestId,
      accessKind: 'selected_for_context',
      accessedAt: now,
      selectedForContext: true,
    });

    const audit = MemoryAuditLogSchema.parse({
      auditLogId: 'memory-audit:1',
      targetKind: 'memory',
      targetId: record.memoryId,
      operation: 'memory_created',
      actor: 'user',
      createdAt: now,
      summary: '用户接受候选记忆。',
    });

    const settings = MemorySettingsSchema.parse({
      workspaceId: 'workspace:1',
      autoCaptureEnabled: true,
      defaultCandidateReviewMode: 'manual',
      updatedAt: now,
    });

    const policy = MemoryPolicySchema.parse({
      allowedScopes: ['user', 'workspace', 'project', 'session'],
      allowedKinds: ['preference', 'project_fact', 'workflow', 'constraint', 'decision'],
      blockedSourceKinds: [],
      requiresReviewRiskLevels: ['medium', 'high'],
      blockedPatterns: ['plaintext secret'],
      autoCaptureEnabled: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.selectedForContext).toBe(true);
    expect(access.accessKind).toBe('selected_for_context');
    expect(audit.operation).toBe('memory_created');
    expect(settings.defaultCandidateReviewMode).toBe('manual');
    expect(policy.requiresReviewRiskLevels).toEqual(['medium', 'high']);
  });

  it('rejects raw source content and unknown fields', () => {
    expect(() =>
      MemorySourceRefSchema.parse({
        sourceRefId: 'memory-source:raw',
        ownerId: 'memory:raw',
        ownerKind: 'memory',
        kind: 'message',
        refId: 'message:raw',
        rawContent: 'raw full prompt',
        createdAt: now,
      }),
    ).toThrow();
  });
});
