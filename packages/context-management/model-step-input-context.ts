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
import type { SessionContextInput } from '@megumi/shared/session-context-contracts';
import type { SessionMessage } from '@megumi/shared/session-run-contracts';
import type { ToolCall, ToolResult } from '@megumi/shared/tool-contracts';
import type { InputIntentCommandMetadata } from '@megumi/shared/input-command-contracts';
import type { ModelInputContextPartDraft } from './context-budget';
import { buildModelInputContext } from './model-input-context-builder';
import { buildSessionContextParts } from './session-context';

const MODEL_INPUT_CONTEXT_ID_PREFIX = 'model-input-context:';
const AGENT_INSTRUCTION_WRAPPER = 'Follow these agent instructions:';

export interface CreateModelStepInputContextIdInput {
  stepId: string;
  contextKind: string;
}

export interface ModelStepRuntimeConstraintInput {
  constraintId: string;
  projectRoot?: string;
  workspaceAccess?: string;
  sandboxSummary?: string;
  approvalSummary?: string;
  loadedAt?: string;
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
  permissionSnapshot?: PermissionModeSnapshot;
  permissionSnapshotRef?: string;
  inputIntent?: InputIntentCommandMetadata;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  budgetPolicy?: ContextBudgetPolicy;
}

export function buildModelStepInputContextFromSources(
  input: BuildModelStepInputContextFromSourcesInput,
): ModelInputContext {
  const toolParts = toolContinuationParts(input);
  const instructionSources = input.instructionSources ?? [];
  const nextInstructionParts = instructionParts(instructionSources);
  const intentParts = intentInstructionParts(input.inputIntent, input.builtAt);
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
        ...intentParts,
        ...input.baseInputContext.parts.filter((part) => (
          part.kind !== 'tool_continuation'
          && !(input.instructionSources && part.kind === 'instruction' && part.instructionKind === 'project')
          && !(input.inputIntent && part.kind === 'instruction' && part.instructionKind === 'intent')
        )).map(draftFromFinalPart),
        ...toolParts,
      ]
    : [
        ...nextInstructionParts,
        ...intentParts,
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
    budgetPolicy: resolveModelStepContextBudgetPolicy(input),
    parts,
    excludedSources,
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

function intentInstructionParts(
  intent: InputIntentCommandMetadata | undefined,
  builtAt: string,
): ModelInputContextPartDraft[] {
  if (!intent) {
    return [];
  }

  const intentMetadata = intent as unknown as JsonObject;
  return [{
    partId: `part:instruction:intent:${intent.commandName}`,
    kind: 'instruction',
    instructionKind: 'intent',
    text: [
      `Input intent: ${intent.intentName}.`,
      `Command: /${intent.commandName}.`,
      intent.argsText ? `Arguments: ${intent.argsText}.` : undefined,
    ].filter((line): line is string => Boolean(line)).join('\n'),
    sourceRefs: [{
      sourceId: `input-intent:${intent.commandName}`,
      sourceKind: 'input_intent',
      sourceUri: `input-intent://${intent.commandName}`,
      loadedAt: builtAt,
      metadata: intentMetadata,
    }],
    priority: 95,
    metadata: {
      intent: intentMetadata,
    },
  }];
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

  for (const constraint of input.runtimeConstraints ?? []) {
    const lines = [
      constraint.projectRoot ? `Project root: ${constraint.projectRoot}` : undefined,
      constraint.workspaceAccess ? `Workspace access: ${constraint.workspaceAccess}` : undefined,
      constraint.sandboxSummary ? `Sandbox: ${constraint.sandboxSummary}` : undefined,
      constraint.approvalSummary ? `Approval: ${constraint.approvalSummary}` : undefined,
    ].filter((line): line is string => Boolean(line));

    if (lines.length > 0) {
      parts.push({
        partId: `part:runtime:project-boundary:${constraint.constraintId}`,
        kind: 'runtime_constraint',
        constraintKind: 'project_boundary',
        text: lines.join('\n'),
        sourceRefs: [{
          sourceId: `runtime-constraint:${constraint.constraintId}`,
          sourceKind: 'project_boundary',
          sourceUri: `runtime-constraint://${constraint.constraintId}`,
          loadedAt: constraint.loadedAt ?? input.builtAt,
        }],
        priority: 85,
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
        sourceKind: 'permission_mode',
        sourceUri: `permission-mode://${input.permissionSnapshotRef ?? input.runId}`,
        loadedAt: input.permissionSnapshot.createdAt,
      }],
      priority: 90,
      metadata: {
        source: input.permissionSnapshot.source,
      },
    });
  }

  return parts;
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
