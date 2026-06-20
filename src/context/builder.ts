// Adapts current src Agent Run facts into the old context-management input model.
import type {
  ModelInputContext,
  ModelInputContextPart,
  ToolContinuationPart,
} from '@megumi/shared/model';
import type { InputPreprocessingEntry, InputPreprocessingResult } from '@megumi/shared/input';
import type { SessionContextInput, SessionHistoryEntry, SessionRuntimeFact } from '@megumi/shared/session';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';
import type { AssistantMessage, Message, ModelContextInput } from '../ai';
import type { ParsedInput, ParsedInputFact } from '../input';
import type { JsonObject, JsonValue } from '../shared';
import {
  buildModelStepInputContextFromSources,
  type ModelStepRuntimeConstraintInput,
  type ModelInputMemoryRecallSource,
} from './model-step-input-context';
import type {
  BuildModelContextInputInput,
  ContextMessageFact,
  ContextToolResultMessageFact,
  ContextTrace,
  ContextTraceEntry,
  TurnSnapshot,
} from './types';

export type { BuildModelContextInputInput };

export function buildModelContextInput(input: BuildModelContextInputInput): TurnSnapshot {
  const builtAt = input.base.parsedInput.createdAt;
  const modelInputContext = buildModelStepInputContextFromSources({
    contextId: `model-input-context:${input.base.runId}:${input.delta.turnIndex}`,
    sessionId: input.base.sessionId,
    runId: input.base.runId,
    stepId: `model-step:${input.base.runId}:${input.delta.turnIndex}`,
    buildReason: input.delta.toolResultMessages.length > 0 ? 'tool_continuation' : 'initial_model_step',
    builtAt,
    currentMessage: {
      messageId: compactContextId('parsed-input', String(input.base.parsedInput.id)),
      sessionId: input.base.sessionId,
      runId: input.base.runId,
      role: 'user',
      content: input.base.parsedInput.text,
      status: 'completed',
      createdAt: builtAt,
      completedAt: builtAt,
    },
    sessionContext: sessionContextInputFromFacts(input.delta.sessionHistory, input.budget),
    inputPreprocessing: inputPreprocessingFromParsedInput(input.base.parsedInput),
    runtimeConstraints: runtimeConstraintsFromInput(input),
    toolCalls: toolCallsFromAssistantMessages({
      runId: input.base.runId,
      turnIndex: input.delta.turnIndex,
      builtAt,
      facts: input.delta.currentRunMessages,
    }),
    toolResults: toolResultsFromFacts({
      runId: input.base.runId,
      facts: input.delta.toolResultMessages,
    }),
    memoryRecallSources: memoryRecallSourcesFromInput(input.delta.memoryContext, builtAt),
  });

  return {
    runId: input.base.runId,
    turnIndex: input.delta.turnIndex,
    parts: modelInputContext.parts,
    modelInputContext,
    modelContextInput: mapModelInputContextToSrcAi(modelInputContext, input.base.systemInstruction),
    toolSet: input.base.toolSet,
    trace: traceFromModelInputContext(modelInputContext, input.base.runId, input.delta.turnIndex),
  };
}

function sessionContextInputFromFacts(
  facts: readonly ContextMessageFact[],
  budget: BuildModelContextInputInput['budget'],
): SessionContextInput {
  const selectedFacts = budget?.maxHistoryMessages && facts.length > budget.maxHistoryMessages
    ? facts.slice(facts.length - budget.maxHistoryMessages)
    : facts;
  const historyEntries: SessionHistoryEntry[] = [];
  const runtimeFacts: SessionRuntimeFact[] = [];

  for (const fact of selectedFacts) {
    const status = stringMetadata(fact.metadata, 'status');
    if (status === 'failed' || status === 'cancelled') {
      runtimeFacts.push({
        factId: fact.id,
        factKind: status === 'failed' ? 'run_failed' : 'run_cancelled',
        text: messageText(fact.message),
        severity: status === 'failed' ? 'error' : 'warning',
        sourceRef: sourceRef({
          sourceId: `session-runtime-fact:${fact.id}`,
          sourceKind: 'session_runtime_fact',
          loadedAt: stringMetadata(fact.metadata, 'createdAt'),
          metadata: jsonObject({ status }),
        }),
      });
      continue;
    }

    if (fact.message.role !== 'user' && fact.message.role !== 'assistant') {
      continue;
    }

    historyEntries.push({
      entryId: fact.id,
      role: fact.message.role,
      text: messageText(fact.message),
      status: 'completed',
      sourceRef: sourceRef({
        sourceId: `session-message:${fact.id}`,
        sourceKind: 'session_message',
        loadedAt: stringMetadata(fact.metadata, 'createdAt'),
        metadata: jsonObject({ role: fact.message.role }),
      }),
    });
  }

  return {
    ...(historyEntries.length > 0 ? { historyEntries } : {}),
    ...(runtimeFacts.length > 0 ? { runtimeFacts } : {}),
    ...(budget?.maxHistoryMessages ? { maxHistoryEntries: budget.maxHistoryMessages } : {}),
  };
}

function inputPreprocessingFromParsedInput(input: ParsedInput): InputPreprocessingResult | undefined {
  const entries = input.facts.flatMap((fact) => inputPreprocessingEntriesFromFact(fact, input));
  if (entries.length === 0) {
    return undefined;
  }

  return {
    inputId: String(input.id),
    originalText: input.text,
    effectiveUserText: input.text,
    entries,
    diagnostics: [],
    createdAt: input.createdAt,
  } as InputPreprocessingResult;
}

function inputPreprocessingEntriesFromFact(
  fact: ParsedInputFact,
  input: ParsedInput,
): InputPreprocessingEntry[] {
  if (fact.kind === 'command') {
    return [{
      kind: 'intent',
      intentId: `command:${fact.commandName}`,
      sourceId: `input-command:${fact.commandName}`,
      sourceName: fact.commandName,
      visibility: 'model_visible',
      instructionText: `Command guidance: ${fact.commandName}\nArguments: ${fact.argsText}`,
      commandName: fact.commandName,
      metadata: jsonObject({ rawText: fact.rawText, parsedInputId: String(input.id) }),
    } as InputPreprocessingEntry];
  }

  if (fact.kind === 'prompt_template') {
    return [{
      kind: 'prompt_template',
      templateId: fact.templateId ?? `prompt-template:${fact.commandName}`,
      sourceId: `input-prompt-template:${fact.commandName}`,
      sourceName: fact.commandName,
      visibility: 'model_visible',
      instructionText: `Command guidance: ${fact.commandName}\nArguments: ${fact.argsText}`,
      commandName: fact.commandName,
      templateSource: 'builtin',
      metadata: jsonObject({ parsedInputId: String(input.id) }),
    } as InputPreprocessingEntry];
  }

  if (fact.kind === 'skill') {
    return [{
      kind: 'skill',
      skillId: `skill:${fact.skillName}`,
      sourceId: `input-skill:${fact.skillName}`,
      sourceName: fact.skillName,
      visibility: 'model_visible',
      instructionText: `Skill guidance: ${fact.skillName}\nArguments: ${fact.argsText}`,
      commandName: fact.skillName,
      skillSource: fact.source === 'explicit_entry' ? 'user' : 'builtin',
      metadata: jsonObject({ parsedInputId: String(input.id) }),
    } as InputPreprocessingEntry];
  }

  return [];
}

function runtimeConstraintsFromInput(input: BuildModelContextInputInput): ModelStepRuntimeConstraintInput[] {
  const builtAt = input.base.parsedInput.createdAt;
  const constraints: ModelStepRuntimeConstraintInput[] = [];
  const workspacePath = stringMetadata(input.base.parsedInput.metadata, 'workspacePath')
    ?? stringMetadata(input.base.metadata, 'workspacePath');
  const permissionMode = stringMetadata(input.base.parsedInput.metadata, 'permissionMode')
    ?? stringMetadata(input.base.metadata, 'permissionMode');

  if (input.base.workspaceId || workspacePath) {
    constraints.push({
      constraintId: compactContextId('runtime-location', input.base.runId, 64),
      projectRoot: workspacePath,
      effectiveCwd: workspacePath,
      workspaceAccess: input.base.workspaceId ? `Workspace id: ${input.base.workspaceId}` : undefined,
      loadedAt: builtAt,
    });
  }

  if (input.base.toolSet.length > 0) {
    constraints.push({
      constraintId: compactContextId('runtime-capabilities', input.base.runId, 64),
      availableCapabilitySummary: `Available tools: ${input.base.toolSet.map((tool) => tool.name).join(', ')}.`,
      loadedAt: builtAt,
    });
  }

  if (permissionMode) {
    constraints.push({
      constraintId: compactContextId('permission-mode', input.base.runId, 64),
      runtimeFactKind: 'permission_posture',
      runtimeFactText: `Permission mode is ${permissionMode}.`,
      required: true,
      loadedAt: builtAt,
    });
  }

  if (input.delta.workspaceChangeSummary) {
    constraints.push({
      constraintId: compactContextId('workspace-change-summary', input.base.runId + ':' + String(input.delta.turnIndex), 64),
      runtimeFactKind: 'workspace_change_summary',
      runtimeFactText: `Workspace change summary: ${input.delta.workspaceChangeSummary}`,
      required: false,
      loadedAt: builtAt,
    });
  }

  return constraints;
}

function memoryRecallSourcesFromInput(
  memoryContext: readonly string[] | undefined,
  builtAt: string,
): ModelInputMemoryRecallSource[] {
  return (memoryContext ?? []).map((text, index) => ({
    sourceId: `memory:${index}`,
    text: `Memory context: ${text}`,
    loadedAt: builtAt,
  }));
}

function toolCallsFromAssistantMessages(input: {
  runId: string;
  turnIndex: number;
  builtAt: string;
  facts: readonly ContextMessageFact[];
}): ToolCall[] {
  const calls: ToolCall[] = [];

  for (const [messageIndex, fact] of input.facts.entries()) {
    if (fact.message.role !== 'assistant') {
      continue;
    }

    const modelStepId = stringMetadata(fact.metadata, 'modelStepId')
      ?? `model-step:${input.runId}:${readTurnIndex(fact.metadata, messageIndex)}`;
    const assistantMessageId = String(fact.id);

    for (const [blockIndex, block] of fact.message.content.entries()) {
      if (block.type !== 'toolCall') {
        continue;
      }
      const parsedInput = parseJsonValue(block.argumentsText);
      calls.push({
        toolCallId: block.id,
        runId: input.runId,
        modelStepId,
        providerToolCallId: block.id,
        toolName: block.name,
        callOrder: calls.length,
        input: parsedInput,
        inputPreview: {
          summary: block.argumentsText.trim().length > 0 ? block.argumentsText : '{}',
          targets: [],
          redactionState: 'none',
        },
        status: 'completed',
        createdAt: input.builtAt,
        completedAt: input.builtAt,
        metadata: jsonObject({
          assistantMessageId,
          sourceContextMessageId: fact.id,
          blockIndex,
          turnIndex: readTurnIndex(fact.metadata, input.turnIndex),
        }),
      });
    }
  }

  return calls;
}

function toolResultsFromFacts(input: {
  runId: string;
  facts: readonly ContextToolResultMessageFact[];
}): ToolResult[] {
  return input.facts.map((fact, index): ToolResult => ({
    toolResultId: fact.id,
    toolCallId: fact.toolCallId,
    toolExecutionId: stringMetadata(fact.metadata, 'toolExecutionId'),
    observationId: stringMetadata(fact.metadata, 'observationId') ?? `observation:${fact.id}`,
    runId: input.runId,
    kind: toolResultKind(fact.status),
    textContent: fact.content,
    ...(fact.status === 'rejected' ? { denialReason: fact.content } : {}),
    redactionState: fact.redaction ? 'redacted' : 'none',
    createdAt: fact.createdAt,
    metadata: jsonObject({
      ...(fact.metadata ?? {}),
      callOrder: numberMetadata(fact.metadata, 'callOrder') ?? index,
    }),
  }));
}

function mapModelInputContextToSrcAi(
  context: ModelInputContext,
  baseSystemPrompt: string,
): ModelContextInput {
  const nativeToolReplay = mapNativeToolReplay(context.parts);
  const consumedPartIds = new Set(nativeToolReplay.consumedPartIds);
  const systemPromptParts = context.parts
    .filter((part) => !consumedPartIds.has(part.partId))
    .filter((part) => part.kind !== 'current_turn')
    .map((part) => part.text)
    .filter((text): text is string => text.trim().length > 0);
  const messages: Message[] = [];

  for (const part of context.parts) {
    if (consumedPartIds.has(part.partId)) {
      continue;
    }
    if (part.kind === 'current_turn') {
      messages.push({ role: 'user', content: part.text });
    }
  }

  messages.push(...nativeToolReplay.messages);

  return {
    systemPrompt: [baseSystemPrompt, ...systemPromptParts].filter((text) => text.trim().length > 0).join('\n\n'),
    messages,
  };
}

function mapNativeToolReplay(parts: readonly ModelInputContextPart[]): {
  messages: Message[];
  consumedPartIds: string[];
} {
  const toolParts = parts.filter((part): part is ToolContinuationPart => part.kind === 'tool_continuation');
  const toolCallParts = toolParts.filter(hasNativeToolCallFields);
  const toolCallById = new Map(toolCallParts.map((part) => [String(part.toolCallId), part]));
  const toolResultParts = toolParts
    .filter(hasNativeToolResultFields)
    .filter((part) => toolCallById.has(String(part.toolCallId)));

  if (toolCallParts.length === 0 || toolResultParts.length === 0) {
    return { messages: [], consumedPartIds: [] };
  }

  const providerStateByModelStepId = new Map<string, string>();
  for (const part of toolParts) {
    if (part.modelStepId && part.providerStateText) {
      providerStateByModelStepId.set(
        part.modelStepId,
        `${providerStateByModelStepId.get(part.modelStepId) ?? ''}${part.providerStateText}`,
      );
    }
  }

  const messages: Message[] = [];
  const consumedPartIds = new Set<string>();
  const replayedModelStepIds = new Set<string>();
  let currentModelStepId: string | undefined;
  let currentToolCalls: ToolContinuationPart[] = [];
  let currentToolResults: Array<{ toolCall?: ToolContinuationPart; toolResult: ToolContinuationPart }> = [];

  const flush = () => {
    if (currentToolCalls.length > 0) {
      const reasoningContent = currentModelStepId ? providerStateByModelStepId.get(currentModelStepId) : undefined;
      const content: AssistantMessage['content'] = [
        ...(reasoningContent ? [{ type: 'thinking' as const, thinking: reasoningContent }] : []),
        ...currentToolCalls.map((part) => ({
          type: 'toolCall' as const,
          id: providerToolCallId(part),
          name: String(part.toolName),
          argumentsText: stringifyToolInput(part.toolInput),
        })),
      ];
      messages.push({ role: 'assistant', content, stopReason: 'tool_calls' });
      if (currentModelStepId) {
        replayedModelStepIds.add(currentModelStepId);
      }
    }

    for (const { toolCall, toolResult } of currentToolResults) {
      messages.push({
        role: 'toolResult',
        toolCallId: providerToolCallId(toolCall ?? toolResult),
        content: toolResult.toolResultContent ?? toolResult.text,
      });
    }

    currentModelStepId = undefined;
    currentToolCalls = [];
    currentToolResults = [];
  };

  for (const toolResultPart of toolResultParts) {
    const toolCall = toolCallById.get(String(toolResultPart.toolCallId));
    const modelStepId = toolCall?.modelStepId;

    if (currentToolResults.length > 0 && modelStepId !== currentModelStepId) {
      flush();
    }

    currentModelStepId = modelStepId;
    if (toolCall) {
      currentToolCalls.push(toolCall);
      consumedPartIds.add(toolCall.partId);
    }
    currentToolResults.push({ toolCall, toolResult: toolResultPart });
    consumedPartIds.add(toolResultPart.partId);
  }

  flush();

  for (const part of toolParts) {
    if (part.providerStateText && part.modelStepId && replayedModelStepIds.has(part.modelStepId)) {
      consumedPartIds.add(part.partId);
    }
  }

  return { messages, consumedPartIds: [...consumedPartIds] };
}

function traceFromModelInputContext(
  context: ModelInputContext,
  runId: string,
  turnIndex: number,
): ContextTrace {
  return {
    runId,
    turnIndex,
    included: context.trace.selectedSources.map((source): ContextTraceEntry => ({
      id: source.partId ?? source.sourceId,
      kind: source.sourceKind ?? 'unknown',
      source: source.sourceKind ?? 'unknown',
      action: 'included',
      reason: source.reason,
    })),
    dropped: context.trace.excludedSources.map((source): ContextTraceEntry => ({
      id: source.partId ?? source.sourceRef.sourceId,
      kind: source.sourceRef.sourceKind,
      source: source.sourceRef.sourceKind,
      action: 'dropped',
      reason: source.reason,
    })),
  };
}

function hasNativeToolCallFields(part: ToolContinuationPart): boolean {
  return Boolean(part.toolCallId && part.toolName && part.toolInput !== undefined);
}

function hasNativeToolResultFields(part: ToolContinuationPart): boolean {
  return Boolean(part.toolCallId && part.toolResultId && part.toolResultContent !== undefined);
}

function providerToolCallId(part: ToolContinuationPart): string {
  return String(part.providerToolCallId ?? part.toolCallId);
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '{}';
  }
}

function parseJsonValue(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

function toolResultKind(status: ContextToolResultMessageFact['status']): ToolResult['kind'] {
  switch (status) {
    case 'success':
      return 'success';
    case 'rejected':
      return 'user_rejected';
    case 'awaiting_approval':
      return 'policy_denied';
    case 'error':
      return 'tool_error';
  }
}

function messageText(message: Message): string {
  if (message.role === 'user' || message.role === 'toolResult') {
    return message.content;
  }

  return message.content.map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'thinking') return block.thinking;
    return `Tool call ${block.name}: ${block.argumentsText}`;
  }).join('\n');
}

function sourceRef(input: {
  sourceId: string;
  sourceKind: SessionHistoryEntry['sourceRef']['sourceKind'];
  loadedAt?: string;
  metadata?: JsonObject;
}): SessionHistoryEntry['sourceRef'] {
  return {
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    sourceUri: `${input.sourceKind}://${input.sourceId}`,
    ...(input.loadedAt ? { loadedAt: input.loadedAt } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function compactContextId(prefix: string, raw: string, maxLength = 96): string {
  const normalized = raw.replace(/[^A-Za-z0-9:_-]/g, '-');
  const full = `${prefix}:${normalized}`;
  if (full.length <= maxLength) {
    return full;
  }
  const suffix = `:${stableHash(full)}`;
  return `${full.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function readTurnIndex(metadata: unknown, fallback: number): number {
  const value = numberMetadata(metadata, 'turnIndex');
  return value ?? fallback;
}

function stringMetadata(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function numberMetadata(metadata: unknown, key: string): number | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function jsonObject(input: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as JsonObject;
}
