// Builds pure turn snapshots from run input facts, history, and current-run continuation.
import type { Message, UserMessage } from '../ai';
import type { ParsedInputFact } from '../input';
import type {
  ContextBudgetOptions,
  ContextMessageFact,
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
  const messages: Message[] = [];

  includeMessage({
    id: String(input.base.parsedInput.id),
    message: createUserMessage(input.base.parsedInput.text),
    entry: {
      id: String(input.base.parsedInput.id),
      kind: 'parsed_input',
      source: 'input',
      action: 'included',
      reason: 'Current parsed input is always visible to the model.',
    },
    messages,
    trace,
    seen,
    budget: input.budget,
  });

  for (const fact of input.base.parsedInput.facts) {
    includeGuidanceFact({
      fact,
      messages,
      trace,
      seen,
      budget: input.budget,
    });
  }

  for (const fact of selectSessionHistory(input.delta.sessionHistory, input.budget, trace)) {
    includeMessage({
      id: fact.id,
      message: fact.message,
      entry: {
        id: fact.id,
        kind: 'session_history',
        source: 'session',
        action: 'included',
        reason: 'Selected session active-path history.',
      },
      messages,
      trace,
      seen,
      budget: input.budget,
    });
  }

  for (const fact of orderedCurrentRunContinuation(input.delta)) {
    if (fact.kind === 'message') {
      includeMessage({
        id: fact.value.id,
        message: fact.value.message,
        entry: {
          id: fact.value.id,
          kind: 'current_run_message',
          source: 'agent',
          action: 'included',
          reason: 'Current run continuation is passed directly by the Agent loop.',
        },
        messages,
        trace,
        seen,
        budget: input.budget,
      });
      continue;
    }

    includeMessage({
      id: fact.value.id,
      message: toAiToolResultMessage(fact.value),
      entry: {
        id: fact.value.id,
        kind: 'tool_result',
        source: 'agent',
        action: 'included',
        reason: 'Tool result continuation is included from current run state.',
      },
      messages,
      trace,
      seen,
      budget: input.budget,
    });
  }

  for (const [index, memory] of input.delta.memoryContext?.entries() ?? []) {
    includeMessage({
      id: `memory:${index}`,
      message: createUserMessage(`Memory context: ${memory}`),
      entry: {
        id: `memory:${index}`,
        kind: 'memory',
        source: 'memory',
        action: 'included',
        reason: 'Memory context was provided by the turn delta.',
      },
      messages,
      trace,
      seen,
      budget: input.budget,
    });
  }

  if (input.delta.workspaceChangeSummary) {
    includeMessage({
      id: 'workspace-change-summary',
      message: createUserMessage(`Workspace change summary: ${input.delta.workspaceChangeSummary}`),
      entry: {
        id: 'workspace-change-summary',
        kind: 'workspace_change',
        source: 'workspace',
        action: 'included',
        reason: 'Workspace changes from prior tool execution are visible to the next turn.',
      },
      messages,
      trace,
      seen,
      budget: input.budget,
    });
  }

  return {
    runId: input.base.runId,
    turnIndex: input.delta.turnIndex,
    modelContextInput: {
      systemPrompt: input.base.systemInstruction,
      messages,
    },
    toolSet: input.base.toolSet,
    trace,
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

function readTurnIndex(metadata: unknown, fallback: number): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return fallback;
  const turnIndex = (metadata as Record<string, unknown>).turnIndex;
  return typeof turnIndex === 'number' && Number.isFinite(turnIndex) ? turnIndex : fallback;
}

function includeGuidanceFact(input: {
  fact: ParsedInputFact;
  messages: Message[];
  trace: ContextTrace;
  seen: Set<string>;
  budget?: ContextBudgetOptions;
}): void {
  if (input.fact.kind === 'command') {
    includeMessage({
      id: `command:${input.fact.commandName}`,
      message: createUserMessage(`Command guidance: ${input.fact.commandName}\nArguments: ${input.fact.argsText}`),
      entry: {
        id: `command:${input.fact.commandName}`,
        kind: 'command_guidance',
        source: 'command',
        action: 'included',
        reason: 'Agent command fact was translated into model-visible guidance.',
      },
      messages: input.messages,
      trace: input.trace,
      seen: input.seen,
      budget: input.budget,
    });
    return;
  }

  if (input.fact.kind === 'prompt_template') {
    includeMessage({
      id: `command:${input.fact.commandName}`,
      message: createUserMessage(`Command guidance: ${input.fact.commandName}\nArguments: ${input.fact.argsText}`),
      entry: {
        id: `command:${input.fact.commandName}`,
        kind: 'command_guidance',
        source: 'command',
        action: 'included',
        reason: 'Prompt template command fact was translated into model-visible guidance.',
      },
      messages: input.messages,
      trace: input.trace,
      seen: input.seen,
      budget: input.budget,
    });
    return;
  }

  if (input.fact.kind === 'skill') {
    includeMessage({
      id: `skill:${input.fact.skillName}`,
      message: createUserMessage(`Skill guidance: ${input.fact.skillName}\nArguments: ${input.fact.argsText}`),
      entry: {
        id: `skill:${input.fact.skillName}`,
        kind: 'skill_guidance',
        source: 'command',
        action: 'included',
        reason: 'Skill fact was translated into model-visible guidance.',
      },
      messages: input.messages,
      trace: input.trace,
      seen: input.seen,
      budget: input.budget,
    });
  }
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

function includeMessage(input: {
  id: string;
  message: Message;
  entry: ContextTraceEntry;
  messages: Message[];
  trace: ContextTrace;
  seen: Set<string>;
  budget?: ContextBudgetOptions;
}): void {
  if (input.seen.has(input.id)) {
    input.trace.dropped.push({
      ...input.entry,
      action: 'deduplicated',
      reason: 'Skipped duplicate fact id within this turn.',
    });
    return;
  }

  input.seen.add(input.id);
  const result = applyCharacterBudget(input.message, input.entry, input.budget);
  input.messages.push(result.message);
  input.trace.included.push(result.entry);
}

function applyCharacterBudget(
  message: Message,
  entry: ContextTraceEntry,
  budget?: ContextBudgetOptions,
): { message: Message; entry: ContextTraceEntry } {
  if (!budget?.maxMessageCharacters || message.role !== 'user' || message.content.length <= budget.maxMessageCharacters) {
    return { message, entry };
  }

  return {
    message: createUserMessage(message.content.slice(0, budget.maxMessageCharacters)),
    entry: {
      ...entry,
      action: 'truncated',
      reason: 'User message content was truncated because maxMessageCharacters was exceeded.',
    },
  };
}

function createUserMessage(content: string): UserMessage {
  return { role: 'user', content };
}
