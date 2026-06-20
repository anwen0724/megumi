// Materializes Agent Run sources into old-architecture-style context parts before provider mapping.
import type { AssistantMessage, Message, UserMessage } from '../ai';
import type { ParsedInputFact } from '../input';
import type {
  ContextBudgetOptions,
  ContextMessageFact,
  ContextPart,
  ContextToolResultMessageFact,
  ContextTrace,
  ContextTraceEntry,
  RunContextBase,
  TurnContextDelta,
  TurnSnapshot,
} from './types';
import { toAiToolResultMessage } from './types';

export interface BuildModelContextInputInput {
  base: RunContextBase;
  delta: TurnContextDelta;
  budget?: ContextBudgetOptions;
}

export function buildModelContextInput(input: BuildModelContextInputInput): TurnSnapshot {
  const trace: ContextTrace = {
    runId: input.base.runId,
    turnIndex: input.delta.turnIndex,
    included: [],
    dropped: [],
  };
  const seen = new Set<string>();
  const parts = buildContextParts(input, trace, seen);

  return {
    runId: input.base.runId,
    turnIndex: input.delta.turnIndex,
    parts,
    modelContextInput: {
      systemPrompt: systemPromptFromParts(input.base.systemInstruction, parts),
      messages: messagesFromParts(parts),
    },
    toolSet: input.base.toolSet,
    trace,
  };
}

function buildContextParts(
  input: BuildModelContextInputInput,
  trace: ContextTrace,
  seen: Set<string>,
): ContextPart[] {
  const parts: ContextPart[] = [];

  for (const part of instructionParts(input.base.parsedInput.facts)) {
    includePart({ part, parts, trace, seen, budget: input.budget });
  }

  for (const part of runtimeConstraintParts(input.base)) {
    includePart({ part, parts, trace, seen, budget: input.budget });
  }

  for (const fact of selectSessionHistory(input.delta.sessionHistory, input.budget, trace)) {
    includePart({
      part: sessionPart(fact),
      parts,
      trace,
      seen,
      budget: input.budget,
    });
  }

  for (const [index, memory] of input.delta.memoryContext?.entries() ?? []) {
    includePart({
      part: {
        id: `memory:${index}`,
        kind: 'memory',
        traceKind: 'memory',
        source: 'memory',
        text: `Memory context: ${memory}`,
        priority: 55,
      },
      parts,
      trace,
      seen,
      budget: input.budget,
    });
  }

  if (input.delta.workspaceChangeSummary) {
    includePart({
      part: {
        id: 'workspace-change-summary',
        kind: 'workspace_change',
        traceKind: 'workspace_change',
        source: 'workspace',
        text: `Workspace change summary: ${input.delta.workspaceChangeSummary}`,
        priority: 60,
      },
      parts,
      trace,
      seen,
      budget: input.budget,
    });
  }

  for (const fact of orderedCurrentRunContinuation(input.delta)) {
    includePart({
      part: fact.kind === 'message'
        ? currentRunMessagePart(fact.value)
        : toolResultPart(fact.value),
      parts,
      trace,
      seen,
      budget: input.budget,
    });
  }

  includePart({
    part: currentTurnPart(input.base.parsedInput.id, input.base.parsedInput.text, input.base.parsedInput.metadata),
    parts,
    trace,
    seen,
    budget: input.budget,
  });

  return parts;
}

function instructionParts(facts: ParsedInputFact[]): ContextPart[] {
  return facts.flatMap((fact): ContextPart[] => {
    if (fact.kind === 'command') {
      return [{
        id: `command:${fact.commandName}`,
        kind: 'instruction',
        traceKind: 'command_guidance',
        source: 'command',
        text: `Command guidance: ${fact.commandName}\nArguments: ${fact.argsText}`,
        priority: 95,
        metadata: { commandName: fact.commandName, rawText: fact.rawText },
      }];
    }

    if (fact.kind === 'prompt_template') {
      return [{
        id: `prompt-template:${fact.commandName}`,
        kind: 'instruction',
        traceKind: 'prompt_template_guidance',
        source: 'command',
        text: `Command guidance: ${fact.commandName}\nArguments: ${fact.argsText}`,
        priority: 92,
        metadata: {
          commandName: fact.commandName,
          ...(fact.templateId ? { templateId: fact.templateId } : {}),
        },
      }];
    }

    if (fact.kind === 'skill') {
      return [{
        id: `skill:${fact.skillName}`,
        kind: 'instruction',
        traceKind: 'skill_guidance',
        source: 'command',
        text: `Skill guidance: ${fact.skillName}\nArguments: ${fact.argsText}`,
        priority: 92,
        metadata: { skillName: fact.skillName, source: fact.source },
      }];
    }

    return [];
  });
}

function runtimeConstraintParts(base: RunContextBase): ContextPart[] {
  const parts: ContextPart[] = [];
  const permissionMode = stringMetadata(base.parsedInput.metadata, 'permissionMode')
    ?? stringMetadata(base.metadata, 'permissionMode');
  const workspacePath = stringMetadata(base.parsedInput.metadata, 'workspacePath')
    ?? stringMetadata(base.metadata, 'workspacePath');

  if (base.workspaceId || workspacePath) {
    parts.push({
      id: `runtime-constraint:${base.runId}:workspace`,
      kind: 'runtime_constraint',
      traceKind: 'runtime_constraint',
      source: 'runtime',
      text: [
        base.workspaceId ? `Workspace id: ${base.workspaceId}.` : undefined,
        workspacePath ? `Workspace path: ${workspacePath}.` : undefined,
      ].filter((line): line is string => Boolean(line)).join('\n'),
      required: true,
      priority: 98,
    });
  }

  if (base.toolSet.length > 0) {
    parts.push({
      id: `runtime-constraint:${base.runId}:capabilities`,
      kind: 'runtime_constraint',
      traceKind: 'runtime_constraint',
      source: 'tools',
      text: `Available tools: ${base.toolSet.map((tool) => tool.name).join(', ')}.`,
      required: true,
      priority: 96,
    });
  }

  if (permissionMode) {
    parts.push({
      id: `runtime-constraint:${base.runId}:permission-mode`,
      kind: 'runtime_constraint',
      traceKind: 'runtime_constraint',
      source: 'permission',
      text: `Permission mode is ${permissionMode}.`,
      required: true,
      priority: 90,
      metadata: { permissionMode },
    });
  }

  return parts;
}

function sessionPart(fact: ContextMessageFact): ContextPart {
  const runtimeStatus = stringMetadata(fact.metadata, 'status');
  if (runtimeStatus === 'failed' || runtimeStatus === 'cancelled') {
    return {
      id: fact.id,
      kind: 'session',
      traceKind: 'session_runtime_fact',
      source: 'session',
      text: messageText(fact.message),
      priority: runtimeStatus === 'failed' ? 80 : 70,
      metadata: fact.metadata,
    };
  }

  return {
    id: fact.id,
    kind: 'session',
    traceKind: 'session_history',
    source: 'session',
    message: fact.message,
    text: messageText(fact.message),
    priority: 50,
    metadata: fact.metadata,
  };
}

function currentRunMessagePart(fact: ContextMessageFact): ContextPart {
  return {
    id: fact.id,
    kind: 'tool_continuation',
    traceKind: 'current_run_message',
    source: 'agent',
    message: fact.message,
    text: messageText(fact.message),
    priority: 80,
    metadata: fact.metadata,
  };
}

function toolResultPart(fact: ContextToolResultMessageFact): ContextPart {
  return {
    id: fact.id,
    kind: 'tool_continuation',
    traceKind: 'tool_result',
    source: 'agent',
    toolResult: fact,
    text: `Tool result ${fact.id} for ${fact.toolCallId}: ${fact.content}`,
    priority: 85,
    metadata: fact.metadata,
  };
}

function currentTurnPart(id: string | number, text: string, metadata: unknown): ContextPart {
  return {
    id: String(id),
    kind: 'current_turn',
    traceKind: 'current_turn',
    source: 'input',
    message: createUserMessage(text),
    text,
    required: true,
    priority: 95,
    metadata: typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? metadata as ContextPart['metadata']
      : undefined,
  };
}

type ContinuationFact =
  | { kind: 'message'; value: ContextMessageFact; turnIndex: number; order: number; originalIndex: number }
  | { kind: 'tool_result'; value: ContextToolResultMessageFact; turnIndex: number; order: number; originalIndex: number };

function orderedCurrentRunContinuation(delta: TurnContextDelta): ContinuationFact[] {
  const assistantFacts = delta.currentRunMessages.map((fact, index): ContinuationFact => ({
    kind: 'message',
    value: fact,
    turnIndex: readTurnIndex(fact.metadata, index),
    order: 0,
    originalIndex: index,
  }));
  const toolFacts = delta.toolResultMessages.map((fact, index): ContinuationFact => ({
    kind: 'tool_result',
    value: fact,
    turnIndex: readTurnIndex(fact.metadata, index),
    order: 1,
    originalIndex: index,
  }));

  return [...assistantFacts, ...toolFacts].sort((left, right) => {
    if (left.turnIndex !== right.turnIndex) return left.turnIndex - right.turnIndex;
    if (left.order !== right.order) return left.order - right.order;
    return left.originalIndex - right.originalIndex;
  });
}

function messagesFromParts(parts: ContextPart[]): Message[] {
  const messages: Message[] = [];

  for (const part of parts) {
    if (part.kind === 'session' && part.message && part.traceKind === 'session_history') {
      messages.push(part.message);
    }
  }

  const currentTurn = parts.find((part) => part.kind === 'current_turn' && part.message);
  if (currentTurn?.message) {
    messages.push(currentTurn.message);
  }

  for (const part of parts) {
    if (part.kind !== 'tool_continuation') {
      continue;
    }
    if (part.message) {
      messages.push(part.message);
    } else if (part.toolResult) {
      messages.push(toAiToolResultMessage(part.toolResult));
    }
  }

  return messages;
}

function systemPromptFromParts(basePrompt: string, parts: ContextPart[]): string {
  const contextualLines = parts
    .filter((part) => (
      part.kind === 'instruction'
      || part.kind === 'runtime_constraint'
      || part.kind === 'memory'
      || part.kind === 'workspace_change'
      || part.traceKind === 'session_runtime_fact'
    ))
    .flatMap((part) => part.text ? [part.text] : []);

  if (contextualLines.length === 0) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${contextualLines.join('\n\n')}`;
}

function selectSessionHistory(
  history: ContextMessageFact[],
  budget: ContextBudgetOptions | undefined,
  trace: ContextTrace,
): ContextMessageFact[] {
  if (!budget?.maxHistoryMessages || history.length <= budget.maxHistoryMessages) {
    return history;
  }

  const keepStart = history.length - budget.maxHistoryMessages;
  for (const dropped of history.slice(0, keepStart)) {
    trace.dropped.push({
      id: dropped.id,
      kind: 'session_history',
      source: 'session',
      action: 'dropped',
      reason: 'Dropped older session history because maxHistoryMessages was exceeded.',
    });
  }

  return history.slice(keepStart);
}

function includePart(input: {
  part: ContextPart;
  parts: ContextPart[];
  trace: ContextTrace;
  seen: Set<string>;
  budget?: ContextBudgetOptions;
}): void {
  if (input.seen.has(input.part.id)) {
    input.trace.dropped.push(traceEntry(input.part, 'deduplicated', 'Skipped duplicate context part id within this turn.'));
    return;
  }

  input.seen.add(input.part.id);
  const part = applyCharacterBudget(input.part, input.budget);
  input.parts.push(part);
  input.trace.included.push(traceEntry(
    part,
    part.text !== input.part.text ? 'truncated' : 'included',
    reasonForPart(part),
  ));
}

function applyCharacterBudget(part: ContextPart, budget?: ContextBudgetOptions): ContextPart {
  if (!budget?.maxMessageCharacters || part.required || !part.text || part.text.length <= budget.maxMessageCharacters) {
    return part;
  }

  const text = part.text.slice(0, budget.maxMessageCharacters);
  const message = part.message?.role === 'user'
    ? createUserMessage(text)
    : part.message;

  return {
    ...part,
    text,
    ...(message ? { message } : {}),
  };
}

function reasonForPart(part: ContextPart): string {
  switch (part.kind) {
    case 'instruction':
      return 'Input-derived command or skill guidance is model-visible.';
    case 'runtime_constraint':
      return 'Runtime constraints are required model context.';
    case 'session':
      return part.traceKind === 'session_runtime_fact'
        ? 'Selected session runtime fact from active path.'
        : 'Selected session active-path history.';
    case 'memory':
      return 'Memory context was provided by the turn delta.';
    case 'workspace_change':
      return 'Workspace changes from prior tool execution are visible to the next turn.';
    case 'tool_continuation':
      return 'Current run continuation is passed directly by the Agent loop.';
    case 'current_turn':
      return 'Current user turn is required and remains the active request.';
  }
}

function traceEntry(
  part: ContextPart,
  action: ContextTraceEntry['action'],
  reason: string,
): ContextTraceEntry {
  return {
    id: part.id,
    kind: part.traceKind,
    source: part.source,
    action,
    reason,
  };
}

function readTurnIndex(metadata: unknown, fallback: number): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fallback;
  const turnIndex = (metadata as Record<string, unknown>).turnIndex;
  return typeof turnIndex === 'number' && Number.isFinite(turnIndex) ? turnIndex : fallback;
}

function stringMetadata(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
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

function createUserMessage(content: string): UserMessage {
  return { role: 'user', content };
}
