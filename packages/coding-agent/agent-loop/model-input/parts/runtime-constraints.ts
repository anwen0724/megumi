// Builds model context parts that describe runtime constraints and run posture.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  ModelInputContext,
  ModelInputContextBuildRequest,
  ModelInputContextSourceRef,
  ModelInputRuntimeConstraintKind,
} from '@megumi/shared/model';
import type { PermissionModeSnapshot } from '@megumi/shared/permission';

import type { ModelInputContextPartDraft } from '../context-budget';

const MODEL_INPUT_CONTEXT_ID_MAX_LENGTH = 128;
const RUNTIME_CONSTRAINT_PART_PREFIX = 'part:runtime-constraint:';
const RUNTIME_CONSTRAINT_BOUNDARY_SUFFIX = ':boundary';
const RUNTIME_CONSTRAINT_CAPABILITIES_SUFFIX = ':capabilities';

export interface ModelStepRuntimeConstraintInput {
  constraintId: string;
  projectRoot?: string;
  effectiveCwd?: string;
  workspaceAccess?: string;
  sandboxSummary?: string;
  approvalSummary?: string;
  availableCapabilitySummary?: string;
  runtimeFactKind?: string;
  runtimeFactText?: string;
  required?: boolean;
  loadedAt?: string;
}

export interface RuntimeConstraintPartsInput {
  builtAt: string;
  runId: string;
  runtimeConstraints?: ModelStepRuntimeConstraintInput[];
  permissionSnapshot?: PermissionModeSnapshot;
  permissionSnapshotRef?: string;
}

export function runtimeConstraintsFromBuildRequest(
  request: ModelInputContextBuildRequest,
): ModelStepRuntimeConstraintInput[] {
  const loadedAt = request.builtAt;
  const constraints: ModelStepRuntimeConstraintInput[] = [];

  if (request.projectRoot || request.effectiveCwd) {
    constraints.push({
      constraintId: runtimeConstraintIdForModelStep('location', request.modelStepId),
      projectRoot: request.projectRoot,
      effectiveCwd: request.effectiveCwd,
      loadedAt,
    });
  }

  if (request.availableCapabilitySummary) {
    constraints.push({
      constraintId: runtimeConstraintIdForModelStep('capabilities', request.modelStepId),
      availableCapabilitySummary: request.availableCapabilitySummary,
      loadedAt,
    });
  }

  for (const fact of request.runtimeFacts) {
    constraints.push({
      constraintId: fact.factId,
      runtimeFactKind: fact.factKind,
      runtimeFactText: fact.text,
      required: fact.required,
      loadedAt,
    });
  }

  return constraints;
}

export function resolveModelCallContextBudgetPolicy(input: {
  budgetPolicy?: ContextBudgetPolicy;
  baseInputContext?: ModelInputContext;
}): ContextBudgetPolicy | undefined {
  if (input.budgetPolicy) {
    return input.budgetPolicy;
  }

  const baseBudget = input.baseInputContext?.budget;
  if (!baseBudget) {
    return undefined;
  }

  return {
    modelContextWindow: baseBudget.modelContextWindow,
    reservedOutputTokens: baseBudget.reservedOutputTokens,
    keepRecentTokens: Math.min(
      baseBudget.keepRecentTokens,
      Math.max(0, baseBudget.modelContextWindow - baseBudget.reservedOutputTokens),
    ),
  };
}

export function runtimeConstraintParts(input: RuntimeConstraintPartsInput): ModelInputContextPartDraft[] {
  const parts: ModelInputContextPartDraft[] = [];

  for (const constraint of input.runtimeConstraints ?? []) {
    const loadedAt = constraint.loadedAt ?? input.builtAt;
    const lines = [
      constraint.projectRoot ? `Project root: ${constraint.projectRoot}` : undefined,
      constraint.effectiveCwd ? `Current working directory: ${constraint.effectiveCwd}` : undefined,
      constraint.workspaceAccess ? `Workspace access: ${constraint.workspaceAccess}` : undefined,
      constraint.sandboxSummary ? `Sandbox: ${constraint.sandboxSummary}` : undefined,
      constraint.approvalSummary ? `Approval: ${constraint.approvalSummary}` : undefined,
    ].filter((line): line is string => Boolean(line));

    if (lines.length > 0) {
      const sourceKind = constraint.effectiveCwd ? 'runtime_fact' : 'project_boundary';
      parts.push({
        partId: `part:runtime-constraint:${constraint.constraintId}:boundary`,
        kind: 'runtime_constraint',
        constraintKind: constraint.effectiveCwd ? 'effective_cwd' : 'project_boundary',
        text: lines.join('\n'),
        sourceRefs: [{
          sourceId: constraint.constraintId,
          sourceKind,
          sourceUri: `runtime-constraint://${constraint.constraintId}`,
          loadedAt,
        }],
        priority: 98,
        budgetClass: 'required',
        required: true,
      });
    }

    if (constraint.availableCapabilitySummary) {
      parts.push({
        partId: `part:runtime-constraint:${constraint.constraintId}:capabilities`,
        kind: 'runtime_constraint',
        constraintKind: 'available_capability_summary',
        text: constraint.availableCapabilitySummary,
        sourceRefs: [{
          sourceId: constraint.constraintId,
          sourceKind: 'runtime_fact',
          sourceUri: `runtime-constraint://${constraint.constraintId}`,
          loadedAt,
        }],
        priority: 96,
        budgetClass: 'required',
        required: true,
      });
    }

    if (constraint.runtimeFactText) {
      const sourceKind = runtimeFactSourceKind(constraint.runtimeFactKind);
      parts.push({
        partId: `part:runtime-fact:${constraint.constraintId}`,
        kind: 'runtime_constraint',
        constraintKind: runtimeFactConstraintKind(constraint.runtimeFactKind),
        text: constraint.runtimeFactText,
        sourceRefs: [{
          sourceId: constraint.constraintId,
          sourceKind,
          sourceUri: `runtime-fact://${constraint.constraintId}`,
          loadedAt,
        }],
        priority: constraint.required ? 95 : 60,
        budgetClass: constraint.required ? 'required' : 'contextual',
        required: constraint.required === true,
        metadata: {
          runtimeFactKind: constraint.runtimeFactKind ?? 'other',
        },
      });
    }
  }

  if (input.permissionSnapshot) {
    parts.push({
      partId: `part:runtime:permission-mode:${input.permissionSnapshotRef ?? input.runId}`,
      kind: 'runtime_constraint',
      constraintKind: 'permission_mode',
      text: `Permission mode is ${input.permissionSnapshot.permissionMode}.`,
      sourceRefs: [{
        sourceId: `permission-mode:${input.permissionSnapshotRef ?? input.runId}`,
        sourceKind: 'permission_constraint',
        sourceUri: `permission-mode://${input.permissionSnapshotRef ?? input.runId}`,
        loadedAt: input.permissionSnapshot.createdAt,
      }],
      priority: 90,
      budgetClass: 'required',
      required: true,
      metadata: {
        source: input.permissionSnapshot.source,
      },
    });
  }

  return parts;
}

function runtimeConstraintIdForModelStep(kind: 'location' | 'capabilities', modelStepId: string): string {
  const prefix = kind === 'location' ? 'runtime-location:' : 'runtime-capabilities:';
  const partSuffix = kind === 'location'
    ? RUNTIME_CONSTRAINT_BOUNDARY_SUFFIX
    : RUNTIME_CONSTRAINT_CAPABILITIES_SUFFIX;
  const maxConstraintIdLength = MODEL_INPUT_CONTEXT_ID_MAX_LENGTH
    - RUNTIME_CONSTRAINT_PART_PREFIX.length
    - partSuffix.length;
  const constraintId = `${prefix}${modelStepId}`;

  if (constraintId.length <= maxConstraintIdLength) {
    return constraintId;
  }

  const availableModelStepIdLength = Math.max(1, maxConstraintIdLength - prefix.length);
  return `${prefix}${modelStepId.slice(0, availableModelStepIdLength)}`;
}

function runtimeFactSourceKind(factKind: string | undefined): ModelInputContextSourceRef['sourceKind'] {
  if (factKind === 'permission_posture') {
    return 'permission_constraint';
  }
  return 'runtime_fact';
}

function runtimeFactConstraintKind(factKind: string | undefined): ModelInputRuntimeConstraintKind {
  if (factKind === 'effective_cwd') {
    return 'effective_cwd';
  }
  if (factKind === 'available_capability_summary') {
    return 'available_capability_summary';
  }
  if (factKind === 'permission_posture') {
    return 'permission_posture';
  }
  return 'other';
}
