import type { JsonObject, JsonValue } from '@megumi/shared/json';
import type {
  ModelInputContext,
  ModelInputContextPart,
  ModelInputContextSourceRef,
} from '@megumi/shared/model-input-context-contracts';
import type { ModelStepProviderState } from '@megumi/shared/model-step-contracts';
import type { PermissionModeSnapshot } from '@megumi/shared/permission-mode-contracts';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { SessionMessage } from '@megumi/shared/session-run-contracts';
import type { ToolResult, ToolUse } from '@megumi/shared/tool-contracts';
import { buildModelInputContext } from './model-input-context-builder';

export interface BuildModelStepInputContextFromSourcesInput {
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  buildReason: string;
  builtAt: string;
  currentMessage?: SessionMessage;
  historyMessages?: SessionMessage[];
  runContext?: RunContext;
  modeSnapshot?: PermissionModeSnapshot;
  modeSnapshotRef?: string;
  toolUses?: ToolUse[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  modelContextWindow?: number;
  reservedOutputTokens?: number;
  availableInputTokens?: number;
}

export function buildModelStepInputContextFromSources(
  input: BuildModelStepInputContextFromSourcesInput,
): ModelInputContext {
  const parts: ModelInputContextPart[] = [
    ...sessionParts(input.historyMessages ?? [], input.builtAt),
    ...runtimeConstraintParts(input),
    ...toolContinuationParts(input),
    ...(input.currentMessage ? [currentTurnPart(input.currentMessage, input.builtAt)] : []),
  ];

  return buildModelInputContext({
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    buildReason: input.buildReason,
    builtAt: input.builtAt,
    modelContextWindow: input.modelContextWindow ?? input.runContext?.budget.modelContextWindow,
    reservedOutputTokens: input.reservedOutputTokens ?? input.runContext?.budget.reservedOutputTokens,
    availableInputTokens: input.availableInputTokens ?? input.runContext?.budget.availableInputTokens,
    parts,
  });
}

function sessionParts(messages: SessionMessage[], builtAt: string): ModelInputContextPart[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message, index): ModelInputContextPart => ({
      partId: `part:session:${index + 1}:${message.messageId}`,
      kind: 'session',
      text: formatSessionMessage(message),
      sourceRefs: [sessionMessageSourceRef(message, builtAt)],
      priority: message.status === 'completed' ? 50 : 70,
      budgetStatus: message.status === 'completed' ? 'included_reduced' : 'included_full',
      metadata: {
        role: message.role,
        status: message.status,
      },
    }));
}

function currentTurnPart(message: SessionMessage, builtAt: string): ModelInputContextPart {
  return {
    partId: `part:current-turn:${message.messageId}`,
    kind: 'current_turn',
    role: message.role === 'user' ? 'user' : 'host',
    text: message.content,
    sourceRefs: [sessionMessageSourceRef(message, builtAt, 'current_user_message')],
    priority: 95,
    budgetStatus: 'included_full',
    metadata: {
      role: message.role,
      status: message.status,
    },
  };
}

function runtimeConstraintParts(input: BuildModelStepInputContextFromSourcesInput): ModelInputContextPart[] {
  const parts: ModelInputContextPart[] = [];

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
      budgetStatus: 'included_full',
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
      budgetStatus: 'included_full',
      metadata: {
        source: input.modeSnapshot.source,
      },
    });
  }

  return parts;
}

function toolContinuationParts(input: BuildModelStepInputContextFromSourcesInput): ModelInputContextPart[] {
  const toolUseParts = (input.toolUses ?? []).map((toolUse, index): ModelInputContextPart => ({
    partId: `part:tool-use:${index + 1}:${toolUse.toolUseId}`,
    kind: 'tool_continuation',
    text: `Tool use ${toolUse.toolUseId} requested ${toolUse.toolName}. Input preview: ${toolUse.inputPreview.summary}.`,
    toolUseId: String(toolUse.toolUseId),
    sourceRefs: [toolUseSourceRef(toolUse, input.builtAt)],
    priority: 80,
    budgetStatus: 'included_full',
    metadata: {
      toolName: toolUse.toolName,
      status: toolUse.status,
    },
  }));

  const toolResultParts = (input.toolResults ?? []).map((toolResult, index): ModelInputContextPart => ({
    partId: `part:tool-result:${index + 1}:${toolResult.toolResultId}`,
    kind: 'tool_continuation',
    text: `Tool result ${toolResult.toolResultId} for ${toolResult.toolUseId}: ${toolResultSummary(toolResult)}.`,
    toolUseId: String(toolResult.toolUseId),
    toolResultId: String(toolResult.toolResultId),
    sourceRefs: [toolResultSourceRef(toolResult)],
    priority: 85,
    budgetStatus: 'included_full',
    metadata: {
      kind: toolResult.kind,
      redactionState: toolResult.redactionState,
    },
  }));

  const providerStateParts = (input.providerStates ?? []).map((providerState, index): ModelInputContextPart => ({
    partId: `part:provider-state:${index + 1}:${providerState.modelStepId}`,
    kind: 'tool_continuation',
    text: providerStateSummary(providerState),
    providerStateIds: [`${providerState.modelStepId}:${index}`],
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
    budgetStatus: 'included_full',
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
  sourceKind: ModelInputContextSourceRef['sourceKind'] = 'timeline_message',
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

function formatSessionMessage(message: SessionMessage): string {
  const status = message.status === 'completed' ? '' : ` [status: ${message.status}]`;
  return `[${message.role}${status}] ${message.content}`;
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
