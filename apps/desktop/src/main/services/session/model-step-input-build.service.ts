// Composes Desktop Main sources into a provider-neutral ModelInputContext for one ModelStep.
// This service does not call providers, execute tools, or perform memory recall scoring.
import {
  buildModelStepInputContextFromBuildRequest,
  createModelStepInputContextId,
  type ModelInputMemoryRecallSource,
} from '@megumi/context-management/model-step-input-context';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContext,
  ModelInputContextBuildRequest,
  ModelStepProviderState,
} from '@megumi/shared/model';
import type { PermissionMode, PermissionModeSnapshot } from '@megumi/shared/permission';
import type { SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolCall, ToolDefinition, ToolResult } from '@megumi/shared/tool';
import type { LoadInstructionSourcesInput } from './agent-instruction-source.service';
import { resolveModelStepEffectiveCwd, type ModelStepEffectiveCwd } from './model-step-effective-cwd';

export interface ModelStepInputBuildInstructionSourceService {
  loadInstructionSources(input: LoadInstructionSourcesInput): Promise<AgentInstructionSourceSnapshot[]>;
}

export interface ModelStepInputBuildIds {
  buildRequestId(input: { runId: string; stepId: string; contextKind: string }): string;
  traceId(input: { runId: string; stepId: string; contextKind: string }): string;
}

export interface ModelStepInputBuildServiceOptions {
  instructionSourceService?: ModelStepInputBuildInstructionSourceService;
  defaultBudgetPolicy?: ContextBudgetPolicy;
  idFactory?: Partial<ModelStepInputBuildIds>;
}

export interface BuildModelStepInputInput {
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
  toolDefinitions?: ToolDefinition[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  providerStates?: ModelStepProviderState[];
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  budgetPolicy?: ContextBudgetPolicy;
  builtAt: string;
}

export interface BuildModelStepInputResult {
  buildRequest: ModelInputContextBuildRequest;
  inputContext: ModelInputContext;
  toolDefinitions: ToolDefinition[];
  instructionSources: AgentInstructionSourceSnapshot[];
  availableCapabilitySummary: string;
  effectiveCwd?: ModelStepEffectiveCwd;
}

const DEFAULT_IDS: ModelStepInputBuildIds = {
  buildRequestId: ({ runId, stepId, contextKind }) => `model-input-build:${runId}:${stepId}:${contextKind}`,
  traceId: ({ runId, stepId, contextKind }) => `trace:model-input:${runId}:${stepId}:${contextKind}`,
};

export class ModelStepInputBuildService {
  private readonly idFactory: ModelStepInputBuildIds;

  constructor(private readonly options: ModelStepInputBuildServiceOptions = {}) {
    this.idFactory = {
      ...DEFAULT_IDS,
      ...options.idFactory,
    };
  }

  async buildModelStepInput(input: BuildModelStepInputInput): Promise<BuildModelStepInputResult> {
    const effectiveCwd = resolveModelStepEffectiveCwd({
      projectRoot: input.projectRoot,
      requestedCwd: input.requestedCwd,
    });
    const instructionSources = await this.loadInstructionSources(input, effectiveCwd);
    const toolDefinitions = input.toolDefinitions ?? [];
    const availableCapabilitySummary = availableCapabilitySummaryFor(toolDefinitions);
    const buildRequest = this.buildRequest(input, effectiveCwd, availableCapabilitySummary);
    const inputContext = buildModelStepInputContextFromBuildRequest({
      request: buildRequest,
      baseInputContext: input.baseInputContext,
      instructionSources,
      sessionContext: input.sessionContext,
      memoryRecallSources: input.memoryRecallSources,
      toolCalls: input.toolCalls,
      toolResults: input.toolResults,
      providerStates: input.providerStates,
      budgetPolicy: input.budgetPolicy ?? this.options.defaultBudgetPolicy,
    });

    return {
      buildRequest,
      inputContext,
      toolDefinitions,
      instructionSources,
      availableCapabilitySummary,
      ...(effectiveCwd ? { effectiveCwd } : {}),
    };
  }

  private async loadInstructionSources(
    input: BuildModelStepInputInput,
    effectiveCwd: ModelStepEffectiveCwd | undefined,
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
    input: BuildModelStepInputInput,
    effectiveCwd: ModelStepEffectiveCwd | undefined,
    availableCapabilitySummary: string,
  ): ModelInputContextBuildRequest {
    const identity = {
      runId: input.runId,
      stepId: input.stepId,
      contextKind: input.contextKind,
    };

    return {
      requestId: this.idFactory.buildRequestId(identity),
      contextId: createModelStepInputContextId({
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
  input: BuildModelStepInputInput,
  effectiveCwd: ModelStepEffectiveCwd | undefined,
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

  return facts;
}
