// Composes Coding Agent product sources into a provider-neutral ModelInputContext for one ModelStep.
// This service does not call providers, execute tools, or perform memory recall scoring.
import {
  buildModelCallInputContextFromBuildRequest,
  createModelCallInputContextId,
  type ModelInputMemoryRecallSource,
} from './model-call-context';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { InputPreprocessingResult } from '../contracts/run-input-preprocessing-contracts';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContext,
  ModelInputContextBuildRequest,
  ModelStepProviderState,
  SessionInstructionSourceSnapshot,
} from '@megumi/shared/model';
import type { PermissionMode, PermissionModeSnapshot } from '@megumi/shared/permission';
import type { SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';
import type { ToolDefinition } from '../../tools';
import { resolveModelCallEffectiveCwd, type ModelCallEffectiveCwd } from './effective-cwd';
import {
  createRuntimeFactsForRunInput,
  type CodingAgentRunInputFacts,
} from '../core/run-input-facts';

import type { LoadInstructionSourcesInput } from '../../adapters/local/context/agent-instruction-source';
export type { LoadInstructionSourcesInput };

export interface ModelCallInputBuildInstructionSourceService {
  loadInstructionSources(input: LoadInstructionSourcesInput): Promise<AgentInstructionSourceSnapshot[]>;
}

export interface ModelCallInputBuildIds {
  buildRequestId(input: { runId: string; stepId: string; contextKind: string }): string;
  traceId(input: { runId: string; stepId: string; contextKind: string }): string;
}

export interface ModelCallInputBuildServiceOptions {
  instructionSourceService?: ModelCallInputBuildInstructionSourceService;
  defaultBudgetPolicy?: ContextBudgetPolicy;
  idFactory?: Partial<ModelCallInputBuildIds>;
}

export interface BuildModelCallInputInput {
  baseInputContext?: ModelInputContext;
  requestId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  contextKind: string;
  providerId: string;
  modelId: string;
  modelContextWindow?: number;
  projectId?: string;
  projectRoot?: string;
  requestedCwd?: string;
  globalInstructionDirs?: string[];
  permissionMode: PermissionMode;
  permissionSnapshot?: PermissionModeSnapshot;
  permissionSnapshotRef?: string;
  currentMessage?: SessionMessage;
  inputPreprocessing?: InputPreprocessingResult;
  sessionContext?: SessionContextInput;
  sessionInstructionSources?: SessionInstructionSourceSnapshot[];
  toolDefinitions?: ToolDefinition[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  runInputFacts?: CodingAgentRunInputFacts;
  budgetPolicy?: ContextBudgetPolicy;
  builtAt: string;
}

export interface BuildModelCallInputResult {
  buildRequest: ModelInputContextBuildRequest;
  inputContext: ModelInputContext;
  toolDefinitions: ToolDefinition[];
  instructionSources: AgentInstructionSourceSnapshot[];
  availableCapabilitySummary: string;
  effectiveCwd?: ModelCallEffectiveCwd;
  failure?: BuildModelCallInputFailure;
}

export interface ModelCallInputBuildPort {
  buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
}

export interface BuildModelCallInputFailure {
  code: 'context_required_over_budget';
  message: string;
  retryable: false;
}

const DEFAULT_IDS: ModelCallInputBuildIds = {
  buildRequestId: ({ runId, stepId, contextKind }) => `model-input-build:${runId}:${stepId}:${contextKind}`,
  traceId: ({ runId, stepId, contextKind }) => `trace:model-input:${runId}:${stepId}:${contextKind}`,
};

export class ModelCallInputBuildService {
  private readonly idFactory: ModelCallInputBuildIds;

  constructor(private readonly options: ModelCallInputBuildServiceOptions = {}) {
    this.idFactory = {
      ...DEFAULT_IDS,
      ...options.idFactory,
    };
  }

  async buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult> {
    const effectiveCwd = resolveModelCallEffectiveCwd({
      projectRoot: input.projectRoot,
      requestedCwd: input.requestedCwd,
    });
    const instructionSources = await this.loadInstructionSources(input, effectiveCwd);
    const toolDefinitions = input.toolDefinitions ?? [];
    const availableCapabilitySummary = availableCapabilitySummaryFor(toolDefinitions);
    const buildRequest = this.buildRequest(input, effectiveCwd, availableCapabilitySummary);
    const inputContext = buildModelCallInputContextFromBuildRequest({
      request: buildRequest,
      baseInputContext: input.baseInputContext,
      instructionSources,
      sessionContext: input.sessionContext,
      sessionInstructionSources: input.sessionInstructionSources,
      inputPreprocessing: input.inputPreprocessing,
      memoryRecallSources: input.memoryRecallSources,
      toolCalls: input.toolCalls,
      toolResults: input.toolResults,
      providerStates: input.providerStates,
      budgetPolicy: input.budgetPolicy ?? this.options.defaultBudgetPolicy,
    });
    const failure = buildFailureForInputContext(inputContext);

    return {
      buildRequest,
      inputContext,
      toolDefinitions,
      instructionSources,
      availableCapabilitySummary,
      ...(effectiveCwd ? { effectiveCwd } : {}),
      ...(failure ? { failure } : {}),
    };
  }

  private async loadInstructionSources(
    input: BuildModelCallInputInput,
    effectiveCwd: ModelCallEffectiveCwd | undefined,
  ): Promise<AgentInstructionSourceSnapshot[]> {
    if (!this.options.instructionSourceService) {
      return [];
    }

    return this.options.instructionSourceService.loadInstructionSources({
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      ...(effectiveCwd ? { effectiveCwd: effectiveCwd.absolutePath } : {}),
      ...(input.globalInstructionDirs ? { globalInstructionDirs: input.globalInstructionDirs } : {}),
      loadedAt: input.builtAt,
    });
  }

  private buildRequest(
    input: BuildModelCallInputInput,
    effectiveCwd: ModelCallEffectiveCwd | undefined,
    availableCapabilitySummary: string,
  ): ModelInputContextBuildRequest {
    const identity = {
      runId: input.runId,
      stepId: input.stepId,
      contextKind: input.contextKind,
    };

    return {
      requestId: this.idFactory.buildRequestId(identity),
      contextId: createModelCallInputContextId({
        stepId: input.stepId,
        contextKind: input.contextKind,
      }),
      sessionId: input.sessionId,
      runId: input.runId,
      modelStepId: input.stepId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      ...(effectiveCwd ? { effectiveCwd: effectiveCwd.absolutePath } : {}),
      permissionMode: input.permissionMode,
      ...(input.permissionSnapshotRef ? { permissionSnapshotRef: input.permissionSnapshotRef } : {}),
      ...(input.currentMessage ? {
        currentTurn: {
          messageId: String(input.currentMessage.messageId),
          effectiveUserText: input.inputPreprocessing?.effectiveUserText ?? input.currentMessage.content,
        },
      } : {}),
      modelTarget: {
        providerId: input.providerId,
        modelId: input.modelId,
        ...(input.modelContextWindow ? { contextWindow: input.modelContextWindow } : {}),
      },
      availableToolsRef: `tool-definitions:${input.runId}`,
      availableCapabilitySummary,
      runtimeFacts: runtimeFactsForInput(input, effectiveCwd),
      ...(input.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecallSeed } : {}),
      traceId: this.idFactory.traceId(identity),
      builtAt: input.builtAt,
      metadata: {
        requestId: input.requestId,
        contextKind: input.contextKind,
        ...(effectiveCwd ? { effectiveCwdProjectRelativePath: effectiveCwd.projectRelativePath } : {}),
      },
    };
  }
}

function buildFailureForInputContext(inputContext: ModelInputContext): BuildModelCallInputFailure | undefined {
  const hasRequiredOverflow = inputContext.trace.budgetWarnings?.some(
    (warning) => warning.reason === 'required_context_over_budget',
  ) === true;
  if (!hasRequiredOverflow) {
    return undefined;
  }

  return {
    code: 'context_required_over_budget',
    message: 'Required model input exceeds the available context budget.',
    retryable: false,
  };
}

function availableCapabilitySummaryFor(toolDefinitions: ToolDefinition[]): string {
  if (toolDefinitions.length === 0) {
    return 'Available tools: none.';
  }

  const tools = toolDefinitions
    .map((definition) => `${definition.name} (${definition.capabilities.join(', ')})`)
    .join(', ');
  return `Available tools: ${tools}.`;
}

function runtimeFactsForInput(
  input: BuildModelCallInputInput,
  effectiveCwd: ModelCallEffectiveCwd | undefined,
): ModelInputContextBuildRequest['runtimeFacts'] {
  const facts: ModelInputContextBuildRequest['runtimeFacts'] = [];

  if (input.projectId || input.projectRoot) {
    facts.push({
      factId: `runtime-fact:${input.runId}:project`,
      factKind: 'project_identity',
      text: [
        input.projectId ? `Project id: ${input.projectId}.` : undefined,
        input.projectRoot ? `Project root: ${input.projectRoot}.` : undefined,
      ].filter(Boolean).join(' '),
      required: true,
    });
  }

  if (effectiveCwd) {
    facts.push({
      factId: `runtime-fact:${input.runId}:effective-cwd`,
      factKind: 'effective_cwd',
      text: `Current working directory: ${effectiveCwd.projectRelativePath}.`,
      required: true,
    });
  }

  if (input.permissionSnapshot) {
    facts.push({
      factId: `runtime-fact:${input.runId}:permission-posture`,
      factKind: 'permission_posture',
      text: `Permission mode: ${input.permissionSnapshot.permissionMode}.`,
      required: true,
    });
  }

  if (input.runInputFacts) {
    facts.push(...createRuntimeFactsForRunInput(input.runInputFacts));
  }

  return facts;
}
