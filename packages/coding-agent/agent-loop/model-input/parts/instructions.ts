// Builds instruction context parts and filters instructions that conflict with runtime posture.
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContextExcludedSource,
  ModelInputContextPart,
  ModelInputContextSourceRef,
  ModelInputContextTruncation,
  ModelInputInstructionKind,
  SessionInstructionSourceSnapshot,
} from '@megumi/shared/model';
import type { PermissionModeSnapshot } from '@megumi/shared/permission';
import type { JsonObject } from '@megumi/shared/primitives';

import type { ModelInputContextPartDraft } from '../context-budget';
import type { ModelStepRuntimeConstraintInput } from './runtime-constraints';

const AGENT_INSTRUCTION_WRAPPER = 'Follow these agent instructions:';
const PERMISSION_BYPASS_PATTERN = /\b(bypass|ignore|skip|disable)\b[\s\S]{0,80}\b(permission|sandbox|approval)\b/i;

export interface InstructionSelectionInput {
  instructionSources?: AgentInstructionSourceSnapshot[];
  runtimeConstraints?: ModelStepRuntimeConstraintInput[];
  permissionSnapshot?: PermissionModeSnapshot;
}

export function selectInstructionSources(input: InstructionSelectionInput): {
  sources: AgentInstructionSourceSnapshot[];
  excludedSources: ModelInputContextExcludedSource[];
} {
  const sources = input.instructionSources ?? [];
  if (!hasPermissionConstraintSource(input)) {
    return { sources, excludedSources: [] };
  }

  const selected: AgentInstructionSourceSnapshot[] = [];
  const excludedSources: ModelInputContextExcludedSource[] = [];

  for (const source of sources) {
    if (instructionConflictsWithPermission(source)) {
      excludedSources.push(conflictingInstructionExcludedSource(source));
      continue;
    }
    selected.push(source);
  }

  return { sources: selected, excludedSources };
}

export function instructionParts(sources: AgentInstructionSourceSnapshot[]): ModelInputContextPartDraft[] {
  return sources
    .filter((source) => source.status === 'included' || source.status === 'included_truncated')
    .map((source): ModelInputContextPartDraft => ({
      partId: `part:instruction:${instructionKindForAgentSource(source)}:${source.sourceId}`,
      kind: 'instruction',
      instructionKind: instructionKindForAgentSource(source),
      text: `${AGENT_INSTRUCTION_WRAPPER}\n\n${source.text}`,
      sourceRefs: [instructionSourceRef(source)],
      priority: instructionPriorityForAgentSource(source),
      budgetClass: 'high_priority',
      ...(source.status === 'included_truncated'
        ? {
            truncationHint: {
              reason: source.reason ?? 'project_instruction_hard_cap_exceeded',
            } satisfies ModelInputContextTruncation,
          }
        : {}),
      metadata: {
        instructionSourceStatus: source.status,
        instructionScope: instructionScopeForAgentSource(source),
        instructionDepth: instructionDepthForAgentSource(source),
      },
    }));
}

export function sessionInstructionParts(sources: SessionInstructionSourceSnapshot[]): ModelInputContextPartDraft[] {
  return sources.map((source): ModelInputContextPartDraft => ({
    partId: `part:instruction:${instructionKindForSessionSource(source)}:${source.sourceId}`,
    kind: 'instruction',
    instructionKind: instructionKindForSessionSource(source),
    text: source.text,
    sourceRefs: [sessionInstructionSourceRef(source)],
    priority: 96,
    budgetClass: 'high_priority',
    metadata: {
      instructionSourceStatus: 'included',
      instructionScope: source.sourceKind === 'session_instruction' ? 'session' : 'mode',
      ...source.metadata,
    },
  }));
}

export function instructionExcludedSourcesFor(
  sources: AgentInstructionSourceSnapshot[],
): ModelInputContextExcludedSource[] {
  return sources
    .filter((source) => source.status !== 'included' && source.status !== 'included_truncated')
    .map((source) => ({
      sourceRef: instructionSourceRef(source),
      reason: source.reason ?? reasonForInstructionSourceStatus(source.status),
    }));
}

export function isFileInstructionPart(part: ModelInputContextPart): boolean {
  return part.kind === 'instruction'
    && part.sourceRefs.some((sourceRef) => (
      sourceRef.sourceKind === 'global_instruction'
      || sourceRef.sourceKind === 'project_instruction'
    ));
}

export function isSessionScopedInstructionPart(part: ModelInputContextPart): boolean {
  return part.kind === 'instruction'
    && part.sourceRefs.some((sourceRef) => (
      sourceRef.sourceKind === 'session_instruction'
      || sourceRef.sourceKind === 'mode_instruction'
    ));
}

function hasPermissionConstraintSource(input: InstructionSelectionInput): boolean {
  return Boolean(
    input.permissionSnapshot
      || input.runtimeConstraints?.some((constraint) => (
        constraint.runtimeFactKind === 'permission_posture'
        || Boolean(constraint.sandboxSummary)
        || Boolean(constraint.approvalSummary)
      )),
  );
}

function instructionConflictsWithPermission(source: AgentInstructionSourceSnapshot): boolean {
  return (source.status === 'included' || source.status === 'included_truncated')
    && PERMISSION_BYPASS_PATTERN.test(source.text);
}

function conflictingInstructionExcludedSource(
  source: AgentInstructionSourceSnapshot,
): ModelInputContextExcludedSource {
  const sourceRef = instructionSourceRef(source);
  return {
    sourceRef: {
      ...sourceRef,
      metadata: cleanMetadata({
        ...sourceRef.metadata,
        diagnosticSeverity: 'warning',
      }),
    },
    reason: 'instruction_conflicts_with_permission_constraint',
    budgetClass: 'diagnostic_only',
  };
}

function instructionSourceRef(source: AgentInstructionSourceSnapshot): ModelInputContextSourceRef {
  return {
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}),
    loadedAt: source.loadedAt,
    metadata: cleanMetadata({
      relativePath: source.relativePath,
      instructionScope: instructionScopeForAgentSource(source),
      instructionDepth: instructionDepthForAgentSource(source),
      status: source.status,
      sizeBytes: source.sizeBytes,
      includedBytes: source.includedBytes,
      hardCapBytes: source.hardCapBytes,
      truncated: source.truncated,
      reason: source.reason,
    }),
  };
}

function sessionInstructionSourceRef(source: SessionInstructionSourceSnapshot): ModelInputContextSourceRef {
  return {
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}),
    loadedAt: source.loadedAt,
    metadata: {
      instructionScope: source.sourceKind === 'session_instruction' ? 'session' : 'mode',
      ...source.metadata,
    },
  };
}

function instructionKindForAgentSource(source: AgentInstructionSourceSnapshot): ModelInputInstructionKind {
  return source.sourceKind === 'global_instruction' ? 'global' : 'project';
}

function instructionKindForSessionSource(source: SessionInstructionSourceSnapshot): ModelInputInstructionKind {
  return source.sourceKind === 'mode_instruction' ? 'mode' : 'session';
}

function instructionPriorityForAgentSource(source: AgentInstructionSourceSnapshot): number {
  if (source.sourceKind === 'global_instruction') {
    return 100;
  }

  return Math.min(99, 97 + instructionDepthForAgentSource(source));
}

function instructionScopeForAgentSource(source: AgentInstructionSourceSnapshot): string {
  if (source.sourceKind === 'global_instruction') {
    return 'global';
  }

  return instructionDepthForAgentSource(source) === 0 ? 'project' : 'project_directory';
}

function instructionDepthForAgentSource(source: AgentInstructionSourceSnapshot): number {
  if (source.sourceKind === 'global_instruction') {
    return 0;
  }

  const relativePath = source.relativePath ?? '';
  const directory = relativePath.split('/').slice(0, -1).filter(Boolean);
  return directory.length;
}

function reasonForInstructionSourceStatus(status: AgentInstructionSourceSnapshot['status']): string {
  switch (status) {
    case 'missing':
      return 'agent_instruction_missing';
    case 'unavailable':
      return 'agent_instruction_no_project_root';
    case 'read_failed':
      return 'agent_instruction_read_failed';
    case 'included_truncated':
      return 'project_instruction_hard_cap_exceeded';
    case 'included':
      return 'instruction';
  }
}

function cleanMetadata(input: Record<string, string | number | boolean | undefined>): JsonObject {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as JsonObject;
}
