// Composes session-owned services with the product input runtime.
import { RunContextService } from '../agent-loop/run-context';
import { createLocalWorkspaceSourceProvider } from '../adapters/local/run-context/workspace-source-provider';
import { createInputService } from '../input';
import { AgentRunProcessingService, createAgentRunService } from '../agent-loop';
import { createCommandService } from '../commands';
import { composeCodingAgentContext } from './compose-coding-agent-context';
import { createLegacyModelInputContextFromPrompt } from '../agent-loop/initial-input/initial-model-input-preparation';
import { DEFAULT_CONTEXT_BUDGET_POLICY } from '../agent-loop/model-input/model-input-context-builder';
import type { RuntimeLogger } from '../host-interface/runtime-logger';
import { createSessionService } from '../session';
import { SessionRepository } from '../session/repositories/session-repository';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import { createAgentRunProcessingCompositionIds } from './agent-run-processing-ids';
import type { MegumiDatabase } from '../persistence/connection';
import type { AgentLoopRepository } from '../persistence/repos/agent-loop.repo';
import type { ArtifactRepository } from '../persistence/repos/artifact.repo';
import type { SessionRepository as LegacySessionRepository } from '../persistence/repos/session.repo';
import type { ToolCallRepository } from '../persistence/repos/tool-call.repo';
import type { WorkspaceChangeService } from '../workspace';
import type { ToolRegistryService } from '../tools';
import { PlanArtifactCompatibilityService, PlanArtifactService } from '../artifacts';
import type { MemoryRuntimeComposition } from './compose-coding-agent-memory';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';
import {
  createWorkspaceChangeFooterProjectorService,
} from '../projections/workspace/workspace-change-footer-projector';
import type { SessionBranchControllerServicePort } from '../host-interface/session/branch-controller';
import type { AgentRunSessionBranchServicePort } from '../agent-loop';
import type { RunRetrySessionBranchServicePort } from '../state';

export interface CodingAgentHomePaths {
  homePath: string;
  sqlitePath: string;
  settingsPath: string;
}

export interface ComposeCodingAgentSessionRuntimeOptions {
  homePaths: CodingAgentHomePaths;
  database: MegumiDatabase;
  runtimeLogger: RuntimeLogger;
  artifactRepository: ArtifactRepository;
  agentLoopRepository: AgentLoopRepository;
  sessionRepository: LegacySessionRepository;
  toolCallRepository: ToolCallRepository;
  workspaceChangeService: WorkspaceChangeService;
  toolRegistry: ToolRegistryService;
  modelCallProviderService: ModelCallProvider;
  toolRuntimeFactory: ToolRuntimeFactory;
  memoryRuntime: MemoryRuntimeComposition['memoryRuntime'];
  chatStreamEventSink?: ConstructorParameters<typeof AgentRunProcessingService>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: ConstructorParameters<typeof PostRunHooksCoordinator>[0]['workspaceChangeFooterProjector'];
}

export function composeCodingAgentSessionRuntime(options: ComposeCodingAgentSessionRuntimeOptions) {
  const agentRunProcessingIds = createAgentRunProcessingCompositionIds();
  const sessionRepository = new SessionRepository(options.database);
  const sessionService = createSessionService({ repository: sessionRepository });
  const runContextService = new RunContextService({
    contextRepository: options.agentLoopRepository,
    workspaceSourceProvider: createLocalWorkspaceSourceProvider(),
  });
  const contextRuntime = composeCodingAgentContext({
    sessionService,
    runtimeEventRepository: options.agentLoopRepository as any,
    summaryModelCallPort: {
      async completePrompt({ prompt }) {
        const now = new Date().toISOString();
        const runId = `context-compaction-run:${crypto.randomUUID()}`;
        const stepId = `context-compaction-step:${crypto.randomUUID()}`;
        const result = await options.modelCallProviderService.completeModelCall({
          requestId: `context-compaction:${prompt.prompt_id}`,
          sessionId: 'context-compaction',
          runId,
          stepId,
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          inputContext: createLegacyModelInputContextFromPrompt({
            prompt,
            sessionId: 'context-compaction',
            runId,
            stepId,
            builtAt: now,
            budgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
          }),
          createdAt: now,
        });
        if (!result.ok) {
          return { status: 'failed' as const, failure: result.error };
        }
        return {
          status: 'ok' as const,
          text: result.text,
          metadata: {
            finish_reason: result.finishReason,
            usage: result.usage,
          },
        };
      },
    },
    modelConfigProvider: () => ({
      model_id: 'default',
      context_window_tokens: 8192,
    }),
  });
  const planArtifactCompatibility = new PlanArtifactCompatibilityService({
    repository: options.artifactRepository,
  });
  const planArtifactService = new PlanArtifactService({
    repository: options.agentLoopRepository,
    planArtifactCompatibility,
  });
  const sessionBranchService = createUnsupportedSessionBranchService();
  const workspaceChanges = options.workspaceChangeService;
  const workspaceChangeFooterProjector = options.workspaceChangeFooterProjector
    ?? createWorkspaceChangeFooterProjectorService({ workspaceChanges });
  const postRunHooks = new PostRunHooksCoordinator({
    repository: {
      listRuntimeEventsByRun: (runId) => options.agentLoopRepository.listRuntimeEventsByRun(runId),
    },
    memoryCaptureService: options.memoryRuntime.captureService,
    megumiHomePath: options.homePaths.homePath,
    workspaceChanges,
    ...(workspaceChangeFooterProjector ? { workspaceChangeFooterProjector } : {}),
  });
  const runTerminalCoordinator = new RunTerminalCoordinator({
    repository: {
      getRun: (runId) => options.agentLoopRepository.getRun(runId),
      saveRun: (run) => options.agentLoopRepository.saveRun(run),
      saveStep: (step) => options.agentLoopRepository.saveStep(step),
      listStepsByRun: (runId) => options.agentLoopRepository.listStepsByRun(runId),
      listRunsByStatuses: (statuses) => options.agentLoopRepository.listRunsByStatuses(statuses),
      listRuntimeEventsByRun: (runId) => options.agentLoopRepository.listRuntimeEventsByRun(runId),
      appendRuntimeEvent: (event) => options.agentLoopRepository.appendRuntimeEvent(event),
    },
    toolRepository: options.toolCallRepository,
    ids: agentRunProcessingIds,
  });
  const runRetryCoordinator = new RunRetryCoordinator({
    repository: {
      getRun: (runId) => options.agentLoopRepository.getRun(runId),
      getMessage: (messageId) => options.sessionRepository.getMessage(messageId),
      listRuntimeEventsByRun: (runId) => options.agentLoopRepository.listRuntimeEventsByRun(runId),
      appendRuntimeEvent: (event) => options.agentLoopRepository.appendRuntimeEvent(event),
    },
    activePathRepository: options.sessionRepository,
    sessionBranchService,
    ids: agentRunProcessingIds,
  });
  const agentRunProcessingService = new AgentRunProcessingService({
    sessionRepository: options.sessionRepository,
    agentLoopRepository: options.agentLoopRepository,
    sessionService,
    postRunHooks,
    runTerminalCoordinator,
    runRetryCoordinator,
    promptContextService: contextRuntime.contextService,
    contextUsageMonitor: contextRuntime.contextUsageMonitor,
    activePathRepository: options.sessionRepository,
    sessionBranchService,
    planArtifactService,
    contextService: runContextService,
    modelCallProvider: options.modelCallProviderService,
    toolRuntimeFactory: options.toolRuntimeFactory,
    toolDefinitionProvider: options.toolRegistry,
    toolCallRepository: options.toolCallRepository,
    workspaceChanges,
    chatStreamEventSink: options.chatStreamEventSink,
    memoryRecallService: options.memoryRuntime.recallService,
    memorySettingsProvider: options.memoryRuntime.memorySettingsProvider,
    memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService,
    megumiHomePath: options.homePaths.homePath,
    ids: agentRunProcessingIds,
  });
  const commandService = createCommandService();
  const inputService = createInputService();
  const agentRunService = createAgentRunService({
    inputService,
    session: sessionService,
    userInput: agentRunProcessingService,
    commandService,
    commandExecutionContextProvider: ({ request }) => (
      request.sessionId
        ? {
            session_id: request.sessionId,
            ...(request.workspaceId ? { workspace_id: request.workspaceId } : {}),
            services: {
              context_compaction: contextRuntime.contextCompactionService,
            },
          }
        : undefined
    ),
  });

  return {
    runContextService,
    contextRuntime,
    sessionService,
    sessionRepository,
    sessionBranchService,
    inputService,
    agentRunService,
    agentRunProcessingService,
    commandService,
    planArtifactService,
  };
}

type TransitionalSessionBranchService =
  & SessionBranchControllerServicePort
  & AgentRunSessionBranchServicePort
  & RunRetrySessionBranchServicePort;

function createUnsupportedSessionBranchService(): TransitionalSessionBranchService {
  return {
    createBranchDraft() {
      throw new Error('Session branch drafts are not available during the Session module boundary transition.');
    },
    cancelBranchDraft() {
      return { cancelled: false, reason: 'branch_marker_not_found' as const, events: [] };
    },
    assertActiveBranchDraftMarker() {
      throw new Error('Session branch drafts are not available during the Session module boundary transition.');
    },
    createBranchFromUserMessage() {
      throw new Error('Manual rerun branch creation is not available during the Session module boundary transition.');
    },
  };
}
