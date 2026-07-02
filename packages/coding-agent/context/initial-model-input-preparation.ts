// Owns initial model input preparation for one agent loop without executing the loop itself.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { InputPreprocessingResult } from '@megumi/coding-agent/input';
import type { ModelInputContextBuildRequest } from '@megumi/shared/model';
import type { PermissionMode, PermissionModeSnapshot } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { ModelCapabilitySummary } from '@megumi/shared/run';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type { Run, RunStep, Session, SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolDefinition } from '../tools';

import type { ParsedInput } from '../input/parsed-input';
import type { MemoryRecallPort } from '../memory';
import { createCodingAgentRunInputFacts } from '../input/facts';
import type {
  BuildModelCallInputInput,
  BuildModelCallInputResult,
} from './model-call-input-builder';
import type {
  CompactIfNeededInput,
  SessionCompactionOrchestrationResult,
} from './compaction';
import {
  DEFAULT_CONTEXT_BUDGET_POLICY,
} from './model-input-context-builder';
import {
  resolveMemoryRecallEffectiveCwd,
} from './effective-cwd';
import type { ModelInputMemoryRecallSource } from './model-call-context';

export interface AgentLoopInitialModelInputContextService {
  createBaselineContext(input: {
    runId: string;
    goal: string;
    workspaceId: string;
    workspacePath: string;
    modelCapabilitySummary: ModelCapabilitySummary;
    contextBudgetPolicy: ContextBudgetPolicy;
  }): { contextBudgetPolicy?: ContextBudgetPolicy } | undefined;
}

export interface AgentLoopInitialModelInputSessionContextService {
  buildSessionContextInput(input: {
    sessionId: string;
    currentRunId: string;
    currentMessageId: string;
    builtAt: string;
  }): SessionContextInput;
}

export interface AgentLoopInitialModelInputSourceOverrideProvider {
  resolveModelInputSourceOverrides(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): Partial<Pick<
    BuildModelCallInputInput,
    'globalInstructionDirs' | 'sessionInstructionSources' | 'requestedCwd'
  >>;
}

export interface AgentLoopInitialModelInputMemoryRecallService {
  recallForNewUserInput(input: {
    projectId?: string;
    projectRoot?: string;
    effectiveCwd?: string;
    sessionId: string;
    runId: string;
    modelStepId: string;
    queryText: string;
    providerId?: string;
    modelId?: string;
    enabled?: boolean;
    createdAt: string;
  }): Promise<AgentLoopInitialModelInputMemoryRecall>;
}

export interface AgentLoopInitialModelInputMemoryRecall {
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
}

export interface AgentLoopInitialModelInputBuildService {
  buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
}

export interface AgentLoopInitialModelInputCompactionOrchestrator {
  compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
}

export interface AgentLoopInitialModelInputPreparationOptions {
  contextService?: AgentLoopInitialModelInputContextService;
  sessionContextInputService: AgentLoopInitialModelInputSessionContextService;
  sourceOverrideProvider: AgentLoopInitialModelInputSourceOverrideProvider;
  memoryRecallService?: AgentLoopInitialModelInputMemoryRecallService;
  modelCallInputBuildService: AgentLoopInitialModelInputBuildService;
  compactionOrchestrator?: AgentLoopInitialModelInputCompactionOrchestrator;
}

export function createAgentLoopInitialModelInputMemoryRecallService(input: {
  memoryRecallService?: MemoryRecallPort;
  megumiHomePath?: string;
}): AgentLoopInitialModelInputMemoryRecallService | undefined {
  if (!input.memoryRecallService || !input.megumiHomePath) {
    return undefined;
  }

  return {
    recallForNewUserInput: async (recallInput) => {
      try {
        const result = await input.memoryRecallService!.recallForNewUserInput({
          homePath: input.megumiHomePath!,
          ...(recallInput.projectId ? { projectId: recallInput.projectId } : {}),
          ...(recallInput.projectRoot ? { projectRoot: recallInput.projectRoot } : {}),
          ...(recallInput.effectiveCwd ? { effectiveCwd: recallInput.effectiveCwd } : {}),
          sessionId: recallInput.sessionId,
          runId: recallInput.runId,
          modelStepId: recallInput.modelStepId,
          queryText: recallInput.queryText,
          ...(recallInput.providerId ? { providerId: recallInput.providerId } : {}),
          ...(recallInput.modelId ? { modelId: recallInput.modelId } : {}),
          ...(typeof recallInput.enabled === 'boolean' ? { enabled: recallInput.enabled } : {}),
          createdAt: recallInput.createdAt,
        });

        return {
          ...(result.memoryRecallSources.length > 0 ? { memoryRecallSources: result.memoryRecallSources } : {}),
          ...(result.memoryRecallSeed ? { memoryRecallSeed: result.memoryRecallSeed } : {}),
        };
      } catch {
        return {};
      }
    },
  };
}

export interface PrepareAgentLoopInitialModelInputInput {
  requestId: string;
  session: Session;
  run: Run;
  step: RunStep;
  userMessage: SessionMessage;
  providerId: ProviderId | string;
  modelId: string;
  permissionMode: PermissionMode;
  inputPreprocessing: InputPreprocessingResult;
  parsedInput?: ParsedInput;
  permissionSnapshot?: PermissionModeSnapshot;
  permissionSnapshotRef?: string;
  runtimeContext?: RuntimeContext;
  createdAt: string;
  memoryEnabled?: boolean;
  toolDefinitions?: ToolDefinition[];
}

export interface AgentLoopInitialModelInputPreparation {
  budgetPolicy: ContextBudgetPolicy;
  memoryRecall: AgentLoopInitialModelInputMemoryRecall;
  compactionProbeModelInput: BuildModelCallInputResult;
  startCompaction(): Promise<SessionCompactionOrchestrationResult>;
  buildInitialModelInput(): Promise<BuildModelCallInputResult>;
}

const DEFAULT_MODEL_CAPABILITY_SUMMARY: ModelCapabilitySummary = {
  providerId: 'unknown',
  modelId: 'unknown',
  modelContextWindow: 8192,
};

const COMPACTION_PROBE_BUDGET_POLICY = {
  modelContextWindow: Number.MAX_SAFE_INTEGER,
  reservedOutputTokens: 0,
  keepRecentTokens: Number.MAX_SAFE_INTEGER,
} satisfies ContextBudgetPolicy;

export class AgentLoopInitialModelInputPreparationService {
  constructor(private readonly options: AgentLoopInitialModelInputPreparationOptions) {}

  async prepare(
    input: PrepareAgentLoopInitialModelInputInput,
  ): Promise<AgentLoopInitialModelInputPreparation> {
    const context = this.options.contextService?.createBaselineContext({
      runId: String(input.run.runId),
      goal: input.userMessage.content,
      workspaceId: String(input.session.workspaceId ?? `workspace:${input.session.sessionId}`),
      workspacePath: input.session.workspacePath ?? '',
      modelCapabilitySummary: DEFAULT_MODEL_CAPABILITY_SUMMARY,
      contextBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
    });
    const budgetPolicy = context?.contextBudgetPolicy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
    const modelInputSourceOverrides = this.options.sourceOverrideProvider.resolveModelInputSourceOverrides({
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      stepId: String(input.step.stepId),
      builtAt: input.createdAt,
    });
    const compactionSessionContext = this.buildSessionContext(input);
    const memoryRecall = await this.recallMemory(input, modelInputSourceOverrides.requestedCwd);
    const runInputFacts = input.parsedInput ? createCodingAgentRunInputFacts(input.parsedInput) : undefined;
    const compactionProbeModelInput = await this.options.modelCallInputBuildService.buildModelCallInput({
      ...this.commonModelInput(input, modelInputSourceOverrides, budgetPolicy),
      contextKind: 'compaction-probe',
      sessionContext: compactionSessionContext,
      ...memoryRecall,
      ...(runInputFacts ? { runInputFacts } : {}),
      ...(input.toolDefinitions ? { toolDefinitions: input.toolDefinitions } : {}),
      budgetPolicy: COMPACTION_PROBE_BUDGET_POLICY,
    });

    return {
      budgetPolicy,
      memoryRecall,
      compactionProbeModelInput,
      startCompaction: async () => {
        if (compactionProbeModelInput.failure || !this.options.compactionOrchestrator) {
          return { status: 'skipped', events: [] };
        }

        return this.options.compactionOrchestrator.compactIfNeeded({
          requestId: input.requestId,
          sessionId: String(input.session.sessionId),
          runId: String(input.run.runId),
          stepId: String(input.step.stepId),
          providerId: input.providerId as ProviderId,
          modelId: input.modelId,
          runtimeContext: input.runtimeContext,
          createdAt: input.createdAt,
          sessionContext: compactionSessionContext,
          budgetProbeInputContext: compactionProbeModelInput.inputContext,
          budgetPolicy,
          startSequence: 1,
        });
      },
      buildInitialModelInput: async () => this.options.modelCallInputBuildService.buildModelCallInput({
        ...this.commonModelInput(input, modelInputSourceOverrides, budgetPolicy),
        contextKind: 'initial',
        sessionContext: this.buildSessionContext(input),
        ...memoryRecall,
        ...(runInputFacts ? { runInputFacts } : {}),
        ...(input.toolDefinitions ? { toolDefinitions: input.toolDefinitions } : {}),
        budgetPolicy,
      }),
    };
  }

  private commonModelInput(
    input: PrepareAgentLoopInitialModelInputInput,
    modelInputSourceOverrides: Partial<Pick<
      BuildModelCallInputInput,
      'globalInstructionDirs' | 'sessionInstructionSources' | 'requestedCwd'
    >>,
    budgetPolicy: ContextBudgetPolicy,
  ): Omit<BuildModelCallInputInput, 'contextKind' | 'sessionContext' | 'budgetPolicy'> {
    return {
      requestId: input.requestId,
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      stepId: String(input.step.stepId),
      providerId: String(input.providerId),
      modelId: input.modelId,
      modelContextWindow: budgetPolicy.modelContextWindow,
      ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
      ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
      ...modelInputSourceOverrides,
      permissionMode: input.permissionMode,
      ...(input.permissionSnapshot ? {
        permissionSnapshot: input.permissionSnapshot,
        ...(input.permissionSnapshotRef ? { permissionSnapshotRef: input.permissionSnapshotRef } : {}),
      } : {}),
      currentMessage: input.userMessage,
      inputPreprocessing: input.inputPreprocessing,
      builtAt: input.createdAt,
    };
  }

  private buildSessionContext(input: PrepareAgentLoopInitialModelInputInput): SessionContextInput {
    return this.options.sessionContextInputService.buildSessionContextInput({
      sessionId: String(input.session.sessionId),
      currentRunId: String(input.run.runId),
      currentMessageId: String(input.userMessage.messageId),
      builtAt: input.createdAt,
    });
  }

  private async recallMemory(
    input: PrepareAgentLoopInitialModelInputInput,
    requestedCwd: string | undefined,
  ): Promise<AgentLoopInitialModelInputMemoryRecall> {
    if (!this.options.memoryRecallService) {
      return {};
    }

    const effectiveCwd = resolveMemoryRecallEffectiveCwd({
      projectRoot: input.session.workspacePath,
      requestedCwd,
    });
    return this.options.memoryRecallService.recallForNewUserInput({
      ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
      ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
      ...(effectiveCwd ? { effectiveCwd } : {}),
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      modelStepId: String(input.step.stepId),
      queryText: input.inputPreprocessing.effectiveUserText,
      providerId: String(input.providerId),
      modelId: input.modelId,
      enabled: input.memoryEnabled,
      createdAt: input.createdAt,
    });
  }
}
