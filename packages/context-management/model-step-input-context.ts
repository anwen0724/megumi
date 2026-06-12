// Materializes normalized runtime input sources into provider-neutral model context parts.
// This module consumes typed sources and never parses raw slash commands.
import type { JsonObject, JsonValue } from '@megumi/shared/primitives';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContext,
  ModelInputContextBuildRequest,
  ModelInputContextExcludedSource,
  ModelInputContextPart,
  ModelInputContextSourceRef,
  ModelInputContextTruncation,
  ModelInputInstructionKind,
  ModelInputRuntimeConstraintKind,
  SessionInstructionSourceSnapshot,
} from '@megumi/shared/model';
import type { ModelStepProviderState } from '@megumi/shared/model';
import type { PermissionModeSnapshot } from '@megumi/shared/permission';
import type { SessionContextInput } from '@megumi/shared/session';
import type { SessionMessage } from '@megumi/shared/session';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';
import type { InputPreprocessingEntry, InputPreprocessingResult } from '@megumi/shared/input';
import type { ModelInputContextPartDraft } from './context-budget';
import { buildModelInputContext } from './model-input-context-builder';
import { buildSessionContextParts } from './session-context';

const MODEL_INPUT_CONTEXT_ID_PREFIX = 'model-input-context:';
const AGENT_INSTRUCTION_WRAPPER = 'Follow these agent instructions:';
const PERMISSION_BYPASS_PATTERN = /\b(bypass|ignore|skip|disable)\b[\s\S]{0,80}\b(permission|sandbox|approval)\b/i;

export interface CreateModelStepInputContextIdInput {
  stepId: string;
  contextKind: string;
}

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

export interface ModelInputMemoryRecallSource {
  sourceId: string;
  text: string;
  memoryIds?: string[];
  loadedAt?: string;
  metadata?: JsonObject;
}

export function createModelStepInputContextId(input: CreateModelStepInputContextIdInput): string {
  const suffix = `:${input.contextKind}`;
  const contextId = `${MODEL_INPUT_CONTEXT_ID_PREFIX}${input.stepId}${suffix}`;

  if (contextId.length <= 128) {
    return contextId;
  }

  const availableStepIdLength = 128 - MODEL_INPUT_CONTEXT_ID_PREFIX.length - suffix.length;
  return `${MODEL_INPUT_CONTEXT_ID_PREFIX}${input.stepId.slice(0, Math.max(1, availableStepIdLength))}${suffix}`;
}

export interface BuildModelStepInputContextFromSourcesInput {
  baseInputContext?: ModelInputContext;
  instructionSources?: AgentInstructionSourceSnapshot[];
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  buildReason: string;
  builtAt: string;
  currentMessage?: SessionMessage;
  sessionContext?: SessionContextInput;
  runtimeConstraints?: ModelStepRuntimeConstraintInput[];
  sessionInstructionSources?: SessionInstructionSourceSnapshot[];
  permissionSnapshot?: PermissionModeSnapshot;
  permissionSnapshotRef?: string;
  inputPreprocessing?: InputPreprocessingResult;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  traceMetadata?: JsonObject;
  budgetPolicy?: ContextBudgetPolicy;
}

export interface BuildModelStepInputContextFromBuildRequestInput {
  request: ModelInputContextBuildRequest;
  baseInputContext?: ModelInputContext;
  instructionSources?: AgentInstructionSourceSnapshot[];
  sessionContext?: SessionContextInput;
  sessionInstructionSources?: SessionInstructionSourceSnapshot[];
  inputPreprocessing?: InputPreprocessingResult;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  budgetPolicy?: ContextBudgetPolicy;
}

export function buildModelStepInputContextFromBuildRequest(
  input: BuildModelStepInputContextFromBuildRequestInput,
): ModelInputContext {
  const { request } = input;
  const currentMessage = request.currentTurn?.effectiveUserText
    ? ({
        messageId: request.currentTurn.messageId ?? `${request.runId}:current-turn`,
        sessionId: request.sessionId,
        runId: request.runId,
        role: 'user',
        content: request.currentTurn.effectiveUserText,
        status: 'completed',
        createdAt: request.builtAt,
        completedAt: request.builtAt,
      } satisfies SessionMessage)
    : undefined;

  return buildModelStepInputContextFromSources({
    baseInputContext: input.baseInputContext,
    instructionSources: input.instructionSources,
    contextId: request.contextId,
    sessionId: request.sessionId,
    runId: request.runId,
    stepId: request.modelStepId,
    buildReason: 'model_step_input_build',
    builtAt: request.builtAt,
    ...(currentMessage ? { currentMessage } : {}),
    sessionContext: input.sessionContext,
    sessionInstructionSources: input.sessionInstructionSources,
    inputPreprocessing: input.inputPreprocessing,
    runtimeConstraints: runtimeConstraintsFromBuildRequest(request),
    toolCalls: input.toolCalls,
    toolResults: input.toolResults,
    providerStates: input.providerStates,
    memoryRecallSources: input.memoryRecallSources,
    budgetPolicy: input.budgetPolicy,
    traceMetadata: {
      traceId: request.traceId,
      ...(request.effectiveCwd ? { effectiveCwd: request.effectiveCwd } : {}),
      modelTarget: {
        providerId: request.modelTarget.providerId,
        modelId: request.modelTarget.modelId,
      },
    },
  });
}

export function buildModelStepInputContextFromSources(
  input: BuildModelStepInputContextFromSourcesInput,
): ModelInputContext {
  const toolParts = toolContinuationParts(input);
  const memoryParts = memoryRecallParts(input.memoryRecallSources ?? [], input.builtAt);
  const instructionSelection = selectInstructionSources(input);
  const instructionSources = instructionSelection.sources;
  const nextInstructionParts = instructionParts(instructionSources);
  const nextSessionInstructionParts = sessionInstructionParts(input.sessionInstructionSources ?? []);
  const inputPreprocessingParts = inputPreprocessingInstructionParts(input.inputPreprocessing, input.builtAt);
  const instructionExcludedSources = [
    ...instructionSelection.excludedSources,
    ...instructionExcludedSourcesFor(input.instructionSources ?? []),
  ];
  const sessionContextResult = buildSessionContextParts({
    input: input.sessionContext,
    builtAt: input.builtAt,
  });
  const excludedSources = [
    ...instructionExcludedSources,
    ...sessionContextResult.excludedSources,
  ];
  const parts: ModelInputContextPartDraft[] = input.baseInputContext
    ? [
        ...nextInstructionParts,
        ...nextSessionInstructionParts,
        ...inputPreprocessingParts,
        ...input.baseInputContext.parts.filter((part) => (
          part.kind !== 'tool_continuation'
          && part.kind !== 'memory'
          && !(input.instructionSources && isFileInstructionPart(part))
          && !(input.sessionInstructionSources && isSessionScopedInstructionPart(part))
          && !(input.inputPreprocessing && isInputDerivedInstructionPart(part))
        )).map(draftFromFinalPart),
        ...memoryParts,
        ...toolParts,
      ]
    : [
        ...nextInstructionParts,
        ...nextSessionInstructionParts,
        ...inputPreprocessingParts,
        ...runtimeConstraintParts(input),
        ...sessionContextResult.parts,
        ...memoryParts,
        ...toolParts,
        ...(input.currentMessage ? [currentTurnPart(input.currentMessage, input.builtAt, input.inputPreprocessing)] : []),
      ];

  return buildModelInputContext({
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    buildReason: input.buildReason,
    builtAt: input.builtAt,
    budgetPolicy: resolveModelStepContextBudgetPolicy(input),
    parts,
    excludedSources,
    traceMetadata: input.traceMetadata,
  });
}

function draftFromFinalPart(part: ModelInputContextPart): ModelInputContextPartDraft {
  const {
    tokenEstimate: _tokenEstimate,
    truncation,
    ...draftWithBudgetStatus
  } = part;
  const draft = { ...draftWithBudgetStatus } as Record<string, unknown>;
  delete draft.budgetStatus;

  return {
    ...draft,
    ...(truncation ? { truncationHint: truncation } : {}),
  } as ModelInputContextPartDraft;
}

function selectInstructionSources(input: BuildModelStepInputContextFromSourcesInput): {
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

function hasPermissionConstraintSource(input: BuildModelStepInputContextFromSourcesInput): boolean {
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

function resolveModelStepContextBudgetPolicy(
  input: BuildModelStepInputContextFromSourcesInput,
): ContextBudgetPolicy | undefined {
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

function instructionParts(sources: AgentInstructionSourceSnapshot[]): ModelInputContextPartDraft[] {
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

function sessionInstructionParts(sources: SessionInstructionSourceSnapshot[]): ModelInputContextPartDraft[] {
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

function instructionExcludedSourcesFor(sources: AgentInstructionSourceSnapshot[]): ModelInputContextExcludedSource[] {
  return sources
    .filter((source) => source.status !== 'included' && source.status !== 'included_truncated')
    .map((source) => ({
      sourceRef: instructionSourceRef(source),
      reason: source.reason ?? reasonForInstructionSourceStatus(source.status),
    }));
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

// Converts runtime-normalized input entries into model-visible instructions.
// Host-only entries remain trace metadata and are not emitted as model text.
function inputPreprocessingInstructionParts(
  inputPreprocessing: InputPreprocessingResult | undefined,
  builtAt: string,
): ModelInputContextPartDraft[] {
  if (!inputPreprocessing) {
    return [];
  }

  return inputPreprocessing.entries
    .filter((entry) => entry.visibility === 'model_visible' && entry.instructionText)
    .map((entry): ModelInputContextPartDraft => ({
      partId: `part:instruction:${inputPreprocessingInstructionKind(entry)}:${inputPreprocessingEntryStableId(entry)}`,
      kind: 'instruction',
      instructionKind: inputPreprocessingInstructionKind(entry),
      text: entry.instructionText ?? '',
      sourceRefs: [inputPreprocessingSourceRef(entry, builtAt)],
      priority: inputPreprocessingPriority(entry),
      metadata: {
        inputPreprocessing: inputPreprocessingMetadata(entry),
      },
    }));
}

function isInputDerivedInstructionPart(part: ModelInputContextPart): boolean {
  return part.kind === 'instruction'
    && (
      part.instructionKind === 'intent'
      || part.instructionKind === 'prompt_template'
      || part.instructionKind === 'skill'
      || part.instructionKind === 'input_hook'
    );
}

function isFileInstructionPart(part: ModelInputContextPart): boolean {
  return part.kind === 'instruction'
    && part.sourceRefs.some((sourceRef) => (
      sourceRef.sourceKind === 'global_instruction'
      || sourceRef.sourceKind === 'project_instruction'
    ));
}

function isSessionScopedInstructionPart(part: ModelInputContextPart): boolean {
  return part.kind === 'instruction'
    && part.sourceRefs.some((sourceRef) => (
      sourceRef.sourceKind === 'session_instruction'
      || sourceRef.sourceKind === 'mode_instruction'
    ));
}

function runtimeConstraintsFromBuildRequest(
  request: ModelInputContextBuildRequest,
): ModelStepRuntimeConstraintInput[] {
  const loadedAt = request.builtAt;
  const constraints: ModelStepRuntimeConstraintInput[] = [];

  if (request.projectRoot || request.effectiveCwd) {
    constraints.push({
      constraintId: `${request.requestId}:runtime-location`,
      projectRoot: request.projectRoot,
      effectiveCwd: request.effectiveCwd,
      loadedAt,
    });
  }

  if (request.availableCapabilitySummary) {
    constraints.push({
      constraintId: `${request.requestId}:available-capabilities`,
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

function memoryRecallParts(
  sources: ModelInputMemoryRecallSource[],
  builtAt: string,
): ModelInputContextPartDraft[] {
  return sources.map((source): ModelInputContextPartDraft => ({
    partId: `part:memory:${source.sourceId}`,
    kind: 'memory',
    memoryKind: 'memory_recall',
    text: source.text,
    memoryIds: source.memoryIds,
    sourceRefs: [{
      sourceId: source.sourceId,
      sourceKind: 'memory_recall',
      sourceUri: `memory-recall://${source.sourceId}`,
      loadedAt: source.loadedAt ?? builtAt,
      ...(source.metadata ? { metadata: source.metadata } : {}),
    }],
    priority: 55,
    budgetClass: 'contextual',
    required: false,
  }));
}

// Maps input preprocessing entries to instructionKind: 'intent',
// instructionKind: 'prompt_template', instructionKind: 'skill', or input_hook.
function inputPreprocessingInstructionKind(
  entry: InputPreprocessingEntry,
): Extract<ModelInputContextPartDraft, { kind: 'instruction' }>['instructionKind'] {
  switch (entry.kind) {
    case 'intent':
      return 'intent';
    case 'prompt_template':
      return 'prompt_template';
    case 'skill':
      return 'skill';
    case 'input_hook':
      return 'input_hook';
  }
}

function inputPreprocessingSourceKind(entry: InputPreprocessingEntry): ModelInputContextSourceRef['sourceKind'] {
  switch (entry.kind) {
    case 'intent':
      return 'input_intent';
    case 'prompt_template':
      return 'input_prompt_template';
    case 'skill':
      return 'input_skill';
    case 'input_hook':
      return 'input_hook';
  }
}

function inputPreprocessingEntryStableId(entry: InputPreprocessingEntry): string {
  switch (entry.kind) {
    case 'intent':
      return entry.intentId;
    case 'prompt_template':
      return entry.templateId;
    case 'skill':
      return entry.skillId;
    case 'input_hook':
      return entry.hookId;
  }
}

function inputPreprocessingSourceUri(entry: InputPreprocessingEntry): string {
  return `input://${entry.kind}/${inputPreprocessingEntryStableId(entry)}`;
}

function inputPreprocessingPriority(entry: InputPreprocessingEntry): number {
  switch (entry.kind) {
    case 'intent':
      return 95;
    case 'prompt_template':
    case 'skill':
      return 92;
    case 'input_hook':
      return 88;
  }
}

function inputPreprocessingMetadata(entry: InputPreprocessingEntry): JsonObject {
  const base = {
    sourceName: entry.sourceName,
    ...entry.metadata,
  };

  switch (entry.kind) {
    case 'intent':
      return {
        ...base,
        intentId: entry.intentId,
        commandName: entry.commandName,
        ...(entry.defaultPermissionMode ? { defaultPermissionMode: entry.defaultPermissionMode } : {}),
        ...(entry.defaultPermissionSource ? { defaultPermissionSource: entry.defaultPermissionSource } : {}),
      } as JsonObject;
    case 'prompt_template':
      return {
        ...base,
        templateId: entry.templateId,
        commandName: entry.commandName,
        templateSource: entry.templateSource,
      } as JsonObject;
    case 'skill':
      return {
        ...base,
        skillId: entry.skillId,
        commandName: entry.commandName,
        skillSource: entry.skillSource,
      } as JsonObject;
    case 'input_hook':
      return {
        ...base,
        hookId: entry.hookId,
        action: entry.action,
      } as JsonObject;
  }
}

function inputPreprocessingSourceRef(
  entry: InputPreprocessingEntry,
  builtAt: string,
): ModelInputContextSourceRef {
  return {
    sourceId: entry.sourceId,
    sourceKind: inputPreprocessingSourceKind(entry),
    sourceUri: inputPreprocessingSourceUri(entry),
    loadedAt: builtAt,
    metadata: inputPreprocessingMetadata(entry),
  };
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

function currentTurnPart(
  message: SessionMessage,
  builtAt: string,
  inputPreprocessing?: InputPreprocessingResult,
): ModelInputContextPartDraft {
  return {
    partId: `part:current-turn:${message.messageId}`,
    kind: 'current_turn',
    role: message.role === 'user' ? 'user' : 'host',
    text: inputPreprocessing?.effectiveUserText ?? message.content,
    sourceRefs: [sessionMessageSourceRef(message, builtAt, 'current_user_message', inputPreprocessing)],
    priority: 95,
    budgetClass: 'required',
    required: true,
    metadata: {
      role: message.role,
      status: message.status,
    },
  };
}
function runtimeConstraintParts(input: BuildModelStepInputContextFromSourcesInput): ModelInputContextPartDraft[] {
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

function toolContinuationParts(input: BuildModelStepInputContextFromSourcesInput): ModelInputContextPartDraft[] {
  const toolCallParts = (input.toolCalls ?? []).map((toolCall, index): ModelInputContextPartDraft => ({
    partId: `part:tool-call:${index + 1}:${toolCall.toolCallId}`,
    kind: 'tool_continuation',
    text: `Tool call ${toolCall.toolCallId} requested ${toolCall.toolName}. Input preview: ${toolCall.inputPreview.summary}.`,
    toolCallId: String(toolCall.toolCallId),
    providerToolCallId: toolCall.providerToolCallId,
    modelStepId: String(toolCall.modelStepId),
    toolName: toolCall.toolName,
    toolInput: toolCall.input,
    sourceRefs: [toolCallSourceRef(toolCall, input.builtAt)],
    priority: 80,
    retentionGroupId: `tool-continuation:${toolCall.toolCallId}`,
    metadata: {
      toolName: toolCall.toolName,
      status: toolCall.status,
    },
  }));

  const toolResultParts = (input.toolResults ?? []).map((toolResult, index): ModelInputContextPartDraft => ({
    partId: `part:tool-result:${index + 1}:${toolResult.toolResultId}`,
    kind: 'tool_continuation',
    text: `Tool result ${toolResult.toolResultId} for ${toolResult.toolCallId}: ${toolResultSummary(toolResult)}.`,
    toolCallId: String(toolResult.toolCallId),
    ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
    toolResultId: String(toolResult.toolResultId),
    toolResultContent: toolResultContent(toolResult),
    sourceRefs: [toolResultSourceRef(toolResult)],
    priority: 85,
    retentionGroupId: `tool-continuation:${toolResult.toolCallId}`,
    metadata: {
      kind: toolResult.kind,
      redactionState: toolResult.redactionState,
    },
  }));

  const providerStateParts = (input.providerStates ?? []).map((providerState, index): ModelInputContextPartDraft => ({
    partId: `part:provider-state:${index + 1}:${providerState.modelStepId}`,
    kind: 'tool_continuation',
    text: providerStateSummary(providerState),
    modelStepId: String(providerState.modelStepId),
    providerStateIds: [`${providerState.modelStepId}:${index}`],
    providerStateText: providerStateSummary(providerState),
    sourceRefs: [{
      sourceId: `provider-state:${providerState.modelStepId}:${index}`,
      sourceKind: 'provider_state',
      sourceUri: `provider-state://${providerState.modelStepId}/${index}`,
      loadedAt: input.builtAt,
      metadata: {
        providerId: providerState.providerId,
        modelId: providerState.modelId,
      },
    }],
    priority: 75,
    retentionGroupId: `provider-state:${providerState.modelStepId}`,
  }));

  return [
    ...toolCallParts,
    ...toolResultParts,
    ...providerStateParts,
  ];
}

function sessionMessageSourceRef(
  message: SessionMessage,
  builtAt: string,
  sourceKind: ModelInputContextSourceRef['sourceKind'] = 'session_message',
  inputPreprocessing?: InputPreprocessingResult,
): ModelInputContextSourceRef {
  return {
    sourceId: `session-message:${message.messageId}`,
    sourceKind,
    sourceUri: `session-message://${message.messageId}`,
    loadedAt: message.completedAt ?? message.createdAt ?? builtAt,
    metadata: {
      role: message.role,
      status: message.status,
      ...(inputPreprocessing ? {
        originalText: inputPreprocessing.originalText,
        inputPreprocessingEntryKinds: inputPreprocessing.entries.map((entry) => entry.kind).join(','),
      } : {}),
    },
  };
}
function toolCallSourceRef(toolCall: ToolCall, loadedAt: string): ModelInputContextSourceRef {
  return {
    sourceId: `tool-call:${toolCall.toolCallId}`,
    sourceKind: 'tool_call',
    sourceUri: `tool-call://${toolCall.toolCallId}`,
    loadedAt: toolCall.createdAt ?? loadedAt,
    metadata: {
      toolName: toolCall.toolName,
      status: toolCall.status,
    },
  };
}

function toolResultSourceRef(toolResult: ToolResult): ModelInputContextSourceRef {
  return {
    sourceId: `tool-result:${toolResult.toolResultId}`,
    sourceKind: 'tool_result',
    sourceUri: `tool-result://${toolResult.toolResultId}`,
    loadedAt: toolResult.createdAt,
    metadata: {
      kind: toolResult.kind,
      redactionState: toolResult.redactionState,
    },
  };
}

function toolResultSummary(toolResult: ToolResult): string {
  if (toolResult.textContent && toolResult.textContent.trim().length > 0) {
    return toolResult.textContent;
  }
  if (toolResult.denialReason && toolResult.denialReason.trim().length > 0) {
    return toolResult.denialReason;
  }
  if (toolResult.error) {
    return toolResult.error.message;
  }
  if (toolResult.structuredContent !== undefined) {
    return stringifyJsonValue(toolResult.structuredContent);
  }
  return toolResult.kind;
}

function toolResultContent(toolResult: ToolResult): string {
  if (toolResult.textContent !== undefined) {
    return toolResult.textContent;
  }
  if (toolResult.denialReason !== undefined) {
    return toolResult.denialReason;
  }
  if (toolResult.error) {
    return toolResult.error.message;
  }
  if (toolResult.structuredContent !== undefined) {
    return stringifyJsonValue(toolResult.structuredContent);
  }
  return toolResult.kind;
}

function providerStateSummary(providerState: ModelStepProviderState): string {
  const blocks = providerState.blocks.map((block) => {
    switch (block.type) {
      case 'reasoning_content':
      case 'thinking':
        return block.text;
      case 'redacted_thinking':
        return '[redacted thinking omitted]';
      default:
        return '';
    }
  }).filter(Boolean);

  return blocks.length > 0
    ? blocks.join('\n')
    : `Provider state recorded for ${providerState.modelStepId}.`;
}

function stringifyJsonValue(value: JsonValue): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable structured content]';
  }
}
