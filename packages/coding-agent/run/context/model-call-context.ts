// Composes focused model context part builders into a provider-neutral model input context.
// This module consumes typed sources and never parses raw slash commands.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContext,
  ModelInputContextBuildRequest,
  ModelStepProviderState,
  SessionInstructionSourceSnapshot,
} from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';
import type { PermissionModeSnapshot } from '@megumi/shared/permission';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';

import type { ModelInputContextPartDraft } from './context-budget';
import { buildModelInputContext } from './model-input-context-builder';
import {
  buildSessionContextParts,
  currentTurnPart,
  draftFromFinalPart,
  inputPreprocessingInstructionParts,
  instructionExcludedSourcesFor,
  instructionParts,
  isFileInstructionPart,
  isInputDerivedInstructionPart,
  isSessionScopedInstructionPart,
  memoryRecallParts,
  type ModelInputMemoryRecallSource,
  providerStateParts,
  resolveModelCallContextBudgetPolicy,
  runtimeConstraintParts,
  runtimeConstraintsFromBuildRequest,
  type ModelStepRuntimeConstraintInput,
  selectInstructionSources,
  sessionInstructionParts,
  toolContinuationParts,
} from './parts';

const MODEL_INPUT_CONTEXT_ID_PREFIX = 'model-input-context:';
const MODEL_INPUT_CONTEXT_ID_MAX_LENGTH = 128;

export type {
  ModelInputMemoryRecallSource,
  ModelStepRuntimeConstraintInput,
};

export interface CreateModelCallInputContextIdInput {
  stepId: string;
  contextKind: string;
}

export function createModelCallInputContextId(input: CreateModelCallInputContextIdInput): string {
  const suffix = `:${input.contextKind}`;
  const contextId = `${MODEL_INPUT_CONTEXT_ID_PREFIX}${input.stepId}${suffix}`;

  if (contextId.length <= MODEL_INPUT_CONTEXT_ID_MAX_LENGTH) {
    return contextId;
  }

  const availableStepIdLength = MODEL_INPUT_CONTEXT_ID_MAX_LENGTH - MODEL_INPUT_CONTEXT_ID_PREFIX.length - suffix.length;
  return `${MODEL_INPUT_CONTEXT_ID_PREFIX}${input.stepId.slice(0, Math.max(1, availableStepIdLength))}${suffix}`;
}

export interface BuildModelCallInputContextFromSourcesInput {
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

export interface BuildModelCallInputContextFromBuildRequestInput {
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

export function buildModelCallInputContextFromBuildRequest(
  input: BuildModelCallInputContextFromBuildRequestInput,
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

  return buildModelCallInputContextFromSources({
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
      ...(request.memoryRecallSeed ? { memoryRecallSeed: request.memoryRecallSeed } : {}),
      modelTarget: {
        providerId: request.modelTarget.providerId,
        modelId: request.modelTarget.modelId,
      },
    },
  });
}

export function buildModelCallInputContextFromSources(
  input: BuildModelCallInputContextFromSourcesInput,
): ModelInputContext {
  const toolParts = toolContinuationParts(input);
  const providerParts = providerStateParts(input.providerStates, input.builtAt);
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
        ...providerParts,
      ]
    : [
        ...nextInstructionParts,
        ...nextSessionInstructionParts,
        ...inputPreprocessingParts,
        ...runtimeConstraintParts(input),
        ...sessionContextResult.parts,
        ...memoryParts,
        ...toolParts,
        ...providerParts,
        ...(input.currentMessage ? [currentTurnPart(input.currentMessage, input.builtAt, input.inputPreprocessing)] : []),
      ];

  return buildModelInputContext({
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    buildReason: input.buildReason,
    builtAt: input.builtAt,
    budgetPolicy: resolveModelCallContextBudgetPolicy(input),
    parts,
    excludedSources,
    traceMetadata: input.traceMetadata,
  });
}
