import { describe, expect, it } from 'vitest';
import {
  ContextPatchSchema,
  ModelCapabilitySummarySchema,
  RunContextBuildSchema,
  RunContextSchema,
  RunContextSourceSchema,
  WorkspaceBoundarySchema,
  CONTEXT_PATCH_OPERATIONS,
  CONTEXT_SOURCE_KINDS,
  CONTEXT_REDACTION_STATES,
} from '@megumi/shared/run-context-contracts';

const createdAt = '2026-05-15T00:00:00.000Z';

function workspaceBoundary() {
  return {
    workspaceId: 'workspace-1',
    rootPath: 'C:/all/work/study/megumi',
    displayName: 'megumi',
    allowedRoots: ['C:/all/work/study/megumi'],
    deniedGlobs: ['**/node_modules/**', '**/.git/**'],
    protectedPaths: ['.env'],
    ignoreSources: ['gitignore', 'megumi_policy'],
    symlinkPolicy: 'deny_outside_workspace',
    outsideWorkspacePolicy: 'deny',
    secretPolicySummary: 'secret-like content is blocked or redacted',
    createdAt,
  };
}

describe('run context contracts', () => {
  it('parses strict workspace boundary snapshots without secret values', () => {
    const parsed = WorkspaceBoundarySchema.parse(workspaceBoundary());

    expect(parsed.outsideWorkspacePolicy).toBe('deny');
    expect(JSON.stringify(parsed)).not.toContain('sk-test');
    expect(() => WorkspaceBoundarySchema.parse({
      ...workspaceBoundary(),
      secretValue: 'sk-test-1234567890abcdef',
    })).toThrow();
  });

  it('parses context source refs with attribution and redaction metadata', () => {
    const source = RunContextSourceSchema.parse({
      sourceId: 'source-1',
      sourceKind: 'workspace_file',
      sourceUri: 'workspace://workspace-1/packages/shared/index.ts',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      relativePath: 'packages/shared/index.ts',
      contentHash: 'sha256:abc123',
      mtime: createdAt,
      range: { startLine: 1, endLine: 20 },
      loadedAt: createdAt,
      freshness: 'fresh',
      redactionState: 'none',
      selectionReason: 'agent_requested',
      metadata: { scorer: 'fixture' },
    });

    expect(source.sourceKind).toBe('workspace_file');
    expect(source.range).toEqual({ startLine: 1, endLine: 20 });
  });

  it('parses RunContext as a restricted context package', () => {
    const context = RunContextSchema.parse({
      contextId: 'context-1',
      runId: 'run-1',
      workspaceBoundary: workspaceBoundary(),
      goal: 'Review workspace context',
      constraints: ['Do not read secrets'],
      inlineContents: [{
        contentId: 'inline-1',
        sourceId: 'source-1',
        kind: 'snippet',
        text: 'export const value = 1;',
        redactionState: 'none',
        tokenEstimate: 6,
      }],
      resourceRefs: [],
      conversationRefs: [],
      messageSummaries: [],
      workspaceSources: [],
      toolObservationRefs: [],
      memoryRecallRefs: [],
      policySummary: {
        workspaceAccess: 'workspace-read',
        restrictedResources: ['.env'],
        approvalSummary: 'No approval grants are implied by context.',
        sandboxSummary: 'Context acquisition is read-only.',
      },
      modelCapabilitySummary: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        modelContextWindow: 64000,
      },
      contextBudgetPolicy: {
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        keepRecentTokens: 59904,
      },
      buildMetadata: {
        buildReason: 'run_baseline',
        builtAt: createdAt,
        selectionRecordIds: [],
        redactionRecordIds: [],
        truncationRecordIds: [],
      },
      createdAt,
    });

    expect(context.workspaceBoundary.rootPath).toBe('C:/all/work/study/megumi');
    expect(context.inlineContents[0]?.text).toContain('export const');
  });

  it('keeps model capability summaries free of budget results', () => {
    const capabilitySummary = ModelCapabilitySummarySchema.parse({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      modelContextWindow: 64000,
      supportsToolCall: true,
      supportsStructuredOutput: false,
      supportsVision: false,
      supportsLongContext: true,
    });

    expect(capabilitySummary.supportsToolCall).toBe(true);
    expect(() => ModelCapabilitySummarySchema.parse({
      ...capabilitySummary,
      supportsToolUse: true,
    })).toThrow();
    expect(() => ModelCapabilitySummarySchema.parse({
      ...capabilitySummary,
      reservedOutputTokens: 4096,
    })).toThrow();
    expect(() => ModelCapabilitySummarySchema.parse({
      ...capabilitySummary,
      availableInputTokens: 59904,
    })).toThrow();
  });

  it('rejects legacy RunContext final budget results', () => {
    const validRunContext = {
      contextId: 'context-1',
      runId: 'run-1',
      workspaceBoundary: workspaceBoundary(),
      goal: 'Review workspace context',
      constraints: ['Do not read secrets'],
      inlineContents: [],
      resourceRefs: [],
      conversationRefs: [],
      messageSummaries: [],
      workspaceSources: [],
      toolObservationRefs: [],
      memoryRecallRefs: [],
      policySummary: {
        workspaceAccess: 'workspace-read',
        restrictedResources: ['.env'],
        approvalSummary: 'No approval grants are implied by context.',
        sandboxSummary: 'Context acquisition is read-only.',
      },
      modelCapabilitySummary: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        modelContextWindow: 64000,
      },
      contextBudgetPolicy: {
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        keepRecentTokens: 59904,
      },
      buildMetadata: {
        buildReason: 'run_baseline',
        builtAt: createdAt,
        selectionRecordIds: [],
        redactionRecordIds: [],
        truncationRecordIds: [],
      },
      createdAt,
    };

    expect(() => RunContextSchema.parse({
      ...validRunContext,
      budget: {
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        availableInputTokens: 59904,
        budgetPolicy: 'balanced',
        packingStrategy: 'priority_then_recent',
        truncationRecords: [],
      },
    })).toThrow();
  });

  it('parses ContextPatch without deleting durable source facts', () => {
    const patch = ContextPatchSchema.parse({
      patchId: 'patch-1',
      runId: 'run-1',
      stepId: 'step-1',
      requestedBy: 'agent',
      operation: 'remove_from_effective_context',
      targetRef: 'source-1',
      reason: 'The file is no longer relevant to this answer.',
      priority: 4,
      createdAt,
      status: 'requested',
      metadata: { durableSourceDeleted: false },
    });

    expect(patch.operation).toBe('remove_from_effective_context');
    expect(patch.status).toBe('requested');
  });

  it('parses effective context build metadata without raw prompt snapshots by default', () => {
    const build = RunContextBuildSchema.parse({
      buildId: 'build-1',
      contextId: 'context-1',
      runId: 'run-1',
      sourceIds: ['source-1'],
      selectionRecordIds: ['selection-1'],
      redactionRecordIds: [],
      truncationRecordIds: [],
      builtAt: createdAt,
      snapshotPolicy: 'metadata_only',
      metadata: { promptSnapshotSaved: false },
    });

    expect(build.snapshotPolicy).toBe('metadata_only');
    expect(JSON.stringify(build)).not.toContain('raw full prompt');
  });

  it('exports spec-defined constants', () => {
    expect(CONTEXT_PATCH_OPERATIONS).toContain('redact');
    expect(CONTEXT_SOURCE_KINDS).toContain('external_resource');
    expect(CONTEXT_REDACTION_STATES).toEqual(['none', 'redacted', 'blocked']);
  });
});
