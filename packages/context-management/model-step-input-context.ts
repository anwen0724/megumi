import type { JsonObject, JsonValue } from '@megumi/shared/json';
import type { ContextBudgetPolicy } from '@megumi/shared/context-budget-contracts';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContext,
  ModelInputContextExcludedSource,
  ModelInputContextPart,
  ModelInputContextSourceRef,
  ModelInputContextTruncation,
} from '@megumi/shared/model-input-context-contracts';
import type { ModelStepProviderState } from '@megumi/shared/model-step-contracts';
import type { PermissionModeSnapshot } from '@megumi/shared/permission-mode-contracts';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { SessionContextInput } from '@megumi/shared/session-context-contracts';
import type { SessionMessage } from '@megumi/shared/session-run-contracts';
import type { ToolResult, ToolUse } from '@megumi/shared/tool-contracts';
import type { ModelInputContextPartDraft } from './context-budget';
import { buildModelInputContext } from './model-input-context-builder';
import { buildSessionContextParts } from './session-context';

const MODEL_INPUT_CONTEXT_ID_PREFIX = 'model-input-context:';
const AGENT_INSTRUCTION_WRAPPER = 'Follow these agent instructions:';

export interface CreateModelStepInputContextIdInput {
  stepId: string;
  contextKind: string;
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
  runContext?: RunContext;
  modeSnapshot?: PermissionModeSnapshot;
  modeSnapshotRef?: string;
  toolUses?: ToolUse[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  budgetPolicy?: ContextBudgetPolicy;
  modelContextWindow?: number;
  reservedOutputTokens?: number;
  availableInputTokens?: number;
  keepRecentTokens?: number;
}

export function buildModelStepInputContextFromSources(
  input: BuildModelStepInputContextFromSourcesInput,
): ModelInputContext {
  const toolParts = toolContinuationParts(input);
  const instructionSources = input.instructionSources ?? [];
  const nextInstructionParts = instructionParts(instructionSources);
  const instructionExcludedSources = instructionExcludedSourcesFor(input.instructionSources ?? []);
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
        ...input.baseInputContext.parts.filter((part) => (
          part.kind !== 'tool_continuation'
          && !(input.instructionSources && part.kind === 'instruction' && part.instructionKind === 'project')
        )).map(draftFromFinalPart),
        ...toolParts,
      ]
    : [
        ...nextInstructionParts,
        ...runtimeConstraintParts(input),
        ...sessionContextResult.parts,
        ...toolParts,
        ...(input.currentMessage ? [currentTurnPart(input.currentMessage, input.builtAt)] : []),
      ];

  return buildModelInputContext({
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    buildReason: input.buildReason,
    builtAt: input.builtAt,
    budgetPolicy: input.budgetPolicy,
    modelContextWindow: input.modelContextWindow
      ?? input.runContext?.budget.modelContextWindow
      ?? input.baseInputContext?.budget.modelContextWindow,
    reservedOutputTokens: input.reservedOutputTokens
      ?? input.runContext?.budget.reservedOutputTokens
      ?? input.baseInputContext?.budget.reservedOutputTokens,
    availableInputTokens: input.availableInputTokens
      ?? input.runContext?.budget.availableInputTokens
      ?? input.baseInputContext?.budget.availableInputTokens,
    keepRecentTokens: input.keepRecentTokens
      ?? input.baseInputContext?.budget.keepRecentTokens,
    parts,
    excludedSources,
  });
}

function draftFromFinalPart(part: ModelInputContextPart): ModelInputContextPartDraft {
  const {
    tokenEstimate: _tokenEstimate,
    budgetStatus: _budgetStatus,
    truncation,
    ...draft
  } = part;
  return {
    ...draft,
    ...(truncation ? { truncationHint: truncation } : {}),
  } as ModelInputContextPartDraft;
}

function instructionParts(sources: AgentInstructionSourceSnapshot[]): ModelInputContextPartDraft[] {
  return sources
    .filter((source) => source.status === 'included' || source.status === 'included_truncated')
    .map((source): ModelInputContextPartDraft => ({
      partId: `part:instruction:project:${source.sourceId}`,
      kind: 'instruction',
      instructionKind: 'project',
      text: `${AGENT_INSTRUCTION_WRAPPER}\n\n${source.text}`,
      sourceRefs: [instructionSourceRef(source)],
      priority: 100,
      ...(source.status === 'included_truncated'
        ? {
            truncationHint: {
              reason: source.reason ?? 'project_instruction_hard_cap_exceeded',
            } satisfies ModelInputContextTruncation,
          }
        : {}),
      metadata: {
        instructionSourceStatus: source.status,
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
    sourceKind: 'project_instruction',
    ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}),
    loadedAt: source.loadedAt,
    metadata: cleanMetadata({
      relativePath: source.relativePath,
      status: source.status,
      sizeBytes: source.sizeBytes,
      includedBytes: source.includedBytes,
      hardCapBytes: source.hardCapBytes,
      truncated: source.truncated,
    }),
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

function currentTurnPart(message: SessionMessage, builtAt: string): ModelInputContextPartDraft {
  return {
    partId: `part:current-turn:${message.messageId}`,
    kind: 'current_turn',
    role: message.role === 'user' ? 'user' : 'host',
    text: message.content,
    sourceRefs: [sessionMessageSourceRef(message, builtAt, 'current_user_message')],
    priority: 95,
    metadata: {
      role: message.role,
      status: message.status,
    },
  };
}

function runtimeConstraintParts(input: BuildModelStepInputContextFromSourcesInput): ModelInputContextPartDraft[] {
  const parts: ModelInputContextPartDraft[] = [];

  if (input.runContext) {
    parts.push({
      partId: `part:runtime:project-boundary:${input.runContext.contextId}`,
      kind: 'runtime_constraint',
      constraintKind: 'project_boundary',
      text: [
        `Project root: ${input.runContext.workspaceBoundary.rootPath}`,
        `Workspace access: ${input.runContext.policySummary.workspaceAccess}`,
        `Sandbox: ${input.runContext.policySummary.sandboxSummary}`,
        `Approval: ${input.runContext.policySummary.approvalSummary}`,
      ].join('\n'),
      sourceRefs: [{
        sourceId: `run-context:${input.runContext.contextId}:project-boundary`,
        sourceKind: 'project_boundary',
        sourceUri: `run-context://${input.runContext.contextId}`,
        loadedAt: input.builtAt,
      }],
      priority: 85,
    });
  }

  if (input.modeSnapshot) {
    parts.push({
      partId: `part:runtime:permission-mode:${input.modeSnapshotRef ?? input.runId}`,
      kind: 'runtime_constraint',
      constraintKind: 'permission_mode',
      text: `Permission mode is ${input.modeSnapshot.permissionMode}.`,
      sourceRefs: [{
        sourceId: `permission-mode:${input.modeSnapshotRef ?? input.runId}`,
        sourceKind: 'permission_mode',
        sourceUri: `permission-mode://${input.modeSnapshotRef ?? input.runId}`,
        loadedAt: input.modeSnapshot.createdAt,
      }],
      priority: 90,
      metadata: {
        source: input.modeSnapshot.source,
      },
    });
  }

  return parts;
}

function toolContinuationParts(input: BuildModelStepInputContextFromSourcesInput): ModelInputContextPartDraft[] {
  const toolUseParts = (input.toolUses ?? []).map((toolUse, index): ModelInputContextPartDraft => ({
    partId: `part:tool-use:${index + 1}:${toolUse.toolUseId}`,
    kind: 'tool_continuation',
    text: `Tool use ${toolUse.toolUseId} requested ${toolUse.toolName}. Input preview: ${toolUse.inputPreview.summary}.`,
    toolUseId: String(toolUse.toolUseId),
    providerToolUseId: toolUse.providerToolUseId,
    modelStepId: String(toolUse.modelStepId),
    toolName: toolUse.toolName,
    toolInput: toolUse.input,
    sourceRefs: [toolUseSourceRef(toolUse, input.builtAt)],
    priority: 80,
    retentionGroupId: `tool-continuation:${toolUse.toolUseId}`,
    metadata: {
      toolName: toolUse.toolName,
      status: toolUse.status,
    },
  }));

  const toolResultParts = (input.toolResults ?? []).map((toolResult, index): ModelInputContextPartDraft => ({
    partId: `part:tool-result:${index + 1}:${toolResult.toolResultId}`,
    kind: 'tool_continuation',
    text: `Tool result ${toolResult.toolResultId} for ${toolResult.toolUseId}: ${toolResultSummary(toolResult)}.`,
    toolUseId: String(toolResult.toolUseId),
    toolResultId: String(toolResult.toolResultId),
    toolResultContent: toolResultContent(toolResult),
    sourceRefs: [toolResultSourceRef(toolResult)],
    priority: 85,
    retentionGroupId: `tool-continuation:${toolResult.toolUseId}`,
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
    ...toolUseParts,
    ...toolResultParts,
    ...providerStateParts,
  ];
}

function sessionMessageSourceRef(
  message: SessionMessage,
  builtAt: string,
  sourceKind: ModelInputContextSourceRef['sourceKind'] = 'session_message',
): ModelInputContextSourceRef {
  return {
    sourceId: `session-message:${message.messageId}`,
    sourceKind,
    sourceUri: `session-message://${message.messageId}`,
    loadedAt: message.completedAt ?? message.createdAt ?? builtAt,
    metadata: {
      role: message.role,
      status: message.status,
    },
  };
}

function toolUseSourceRef(toolUse: ToolUse, loadedAt: string): ModelInputContextSourceRef {
  return {
    sourceId: `tool-use:${toolUse.toolUseId}`,
    sourceKind: 'tool_use',
    sourceUri: `tool-use://${toolUse.toolUseId}`,
    loadedAt: toolUse.createdAt ?? loadedAt,
    metadata: {
      toolName: toolUse.toolName,
      status: toolUse.status,
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
