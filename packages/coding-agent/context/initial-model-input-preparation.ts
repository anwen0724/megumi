// Owns initial model input preparation for one agent loop without executing the loop itself.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { InputPreprocessingResult } from '@megumi/coding-agent/input';
import type { ModelInputContext, ModelInputContextBuildRequest } from '@megumi/shared/model';
import type { PermissionMode, PermissionModeSnapshot } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { ModelCapabilitySummary } from '@megumi/shared/run';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type { Run, RunStep, Session, SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolDefinition } from '../tools';

import type { ParsedInput } from '../input/parsed-input';
import type { BuildPromptResult, GetSessionContextResult, Prompt, SessionContext } from './contracts/context-contracts';
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
  buildModelInputContext,
  DEFAULT_CONTEXT_BUDGET_POLICY,
} from './model-input-context-builder';
import type { ModelInputContextPartDraft } from './context-budget';
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

export interface AgentLoopInitialPromptContextService {
  getSessionContext(input: {
    session_id: string;
    workspace_id?: string;
    purpose?: 'agent_response' | 'context_compaction';
  }): Promise<GetSessionContextResult>;
  buildPrompt(input: {
    session_context: SessionContext;
    purpose: 'agent_response';
    current_user_message_id?: string;
  }): BuildPromptResult;
}

export interface AgentLoopInitialModelInputPreparationOptions {
  contextService?: AgentLoopInitialModelInputContextService;
  promptContextService?: AgentLoopInitialPromptContextService;
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
      buildInitialModelInput: async () => this.buildInitialModelInput(
        input,
        modelInputSourceOverrides,
        budgetPolicy,
        memoryRecall,
        runInputFacts,
      ),
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

  private async buildInitialModelInput(
    input: PrepareAgentLoopInitialModelInputInput,
    modelInputSourceOverrides: Partial<Pick<
      BuildModelCallInputInput,
      'globalInstructionDirs' | 'sessionInstructionSources' | 'requestedCwd'
    >>,
    budgetPolicy: ContextBudgetPolicy,
    memoryRecall: AgentLoopInitialModelInputMemoryRecall,
    runInputFacts: ReturnType<typeof createCodingAgentRunInputFacts> | undefined,
  ): Promise<BuildModelCallInputResult> {
    if (!this.options.promptContextService) {
      return this.options.modelCallInputBuildService.buildModelCallInput({
        ...this.commonModelInput(input, modelInputSourceOverrides, budgetPolicy),
        contextKind: 'initial',
        sessionContext: this.buildSessionContext(input),
        ...memoryRecall,
        ...(runInputFacts ? { runInputFacts } : {}),
        ...(input.toolDefinitions ? { toolDefinitions: input.toolDefinitions } : {}),
        budgetPolicy,
      });
    }

    const sessionContextResult = await this.options.promptContextService.getSessionContext({
      session_id: String(input.session.sessionId),
      ...(input.session.workspaceId ? { workspace_id: String(input.session.workspaceId) } : {}),
      purpose: 'agent_response',
    });
    if (sessionContextResult.status !== 'ok') {
      throw new Error(sessionContextResult.failure.message);
    }
    const promptResult = this.options.promptContextService.buildPrompt({
      session_context: sessionContextResult.session_context,
      purpose: 'agent_response',
      current_user_message_id: String(input.userMessage.messageId),
    });
    if (promptResult.status !== 'ok') {
      throw new Error(promptResult.failure.message);
    }
    const inputContext = createLegacyModelInputContextFromPrompt({
      prompt: promptResult.prompt,
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      stepId: String(input.step.stepId),
      builtAt: input.createdAt,
      budgetPolicy,
    });
    const buildRequest: ModelInputContextBuildRequest = {
      requestId: `model-input-build:${input.run.runId}:${input.step.stepId}:initial`,
      contextId: inputContext.contextId,
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      modelStepId: String(input.step.stepId),
      ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
      ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
      permissionMode: input.permissionMode,
      currentTurn: {
        messageId: String(input.userMessage.messageId),
        effectiveUserText: input.inputPreprocessing.effectiveUserText,
      },
      modelTarget: {
        providerId: String(input.providerId),
        modelId: input.modelId,
      },
      availableCapabilitySummary: availableCapabilitySummaryFor(input.toolDefinitions ?? []),
      runtimeFacts: [],
      traceId: `trace:model-input:${input.run.runId}:${input.step.stepId}:initial`,
      builtAt: input.createdAt,
      metadata: { requestId: input.requestId, contextKind: 'initial', compatibility: 'context_prompt' },
    };

    return {
      buildRequest,
      inputContext,
      toolDefinitions: input.toolDefinitions ?? [],
      instructionSources: [],
      availableCapabilitySummary: availableCapabilitySummaryFor(input.toolDefinitions ?? []),
    };
  }
}

function availableCapabilitySummaryFor(toolDefinitions: ToolDefinition[]): string {
  if (toolDefinitions.length === 0) {
    return 'Available tools: none.';
  }

  return `Available tools: ${toolDefinitions.map((definition) => definition.name).join(', ')}.`;
}

export function createLegacyModelInputContextFromPrompt(input: {
  prompt: Prompt;
  sessionId: string;
  runId: string;
  stepId: string;
  builtAt: string;
  budgetPolicy?: ContextBudgetPolicy;
}): ModelInputContext {
  const parts: ModelInputContextPartDraft[] = input.prompt.messages.map((message, index) => {
    if (message.role === 'user') {
      return {
        partId: `legacy-prompt:${input.prompt.prompt_id}:user:${index}`,
        kind: 'current_turn',
        role: 'user',
        text: message.content,
        sourceRefs: [{
          sourceId: `legacy-prompt:${input.prompt.prompt_id}:user:${index}`,
          sourceKind: 'current_user_message',
          metadata: { promptId: input.prompt.prompt_id },
        }],
        priority: 100,
        required: true,
      };
    }

    return {
      partId: `legacy-prompt:${input.prompt.prompt_id}:system:${index}`,
      kind: 'instruction',
      instructionKind: 'system',
      text: message.content,
      sourceRefs: [{
        sourceId: `legacy-prompt:${input.prompt.prompt_id}:system:${index}`,
        sourceKind: 'system_instruction',
        metadata: { promptId: input.prompt.prompt_id },
      }],
      priority: 100,
      required: true,
    };
  });

  return buildModelInputContext({
    contextId: `legacy-context:${input.prompt.prompt_id}`,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    buildReason: 'context_prompt_compatibility',
    builtAt: input.builtAt,
    budgetPolicy: input.budgetPolicy,
    parts,
    traceMetadata: {
      promptId: input.prompt.prompt_id,
      promptPurpose: input.prompt.purpose,
      compatibility: 'context_prompt',
    },
  });
}
