// Composes session-owned services with the product input runtime.
import { PermissionSnapshotService } from '../permissions/permission-snapshot-service';
import { RunContextService } from '../agent-loop/run-context';
import { createLocalWorkspaceSourceProvider } from '../adapters/local/run-context/workspace-source-provider';
import { createInputService, InputProcessingService } from '../input/input-service';
import { createCommandService } from '../commands';
import { composeCodingAgentContext } from './compose-coding-agent-context';
import { createLegacyModelInputContextFromPrompt } from '../agent-loop/initial-input/initial-model-input-preparation';
import { DEFAULT_CONTEXT_BUDGET_POLICY } from '../agent-loop/model-input/model-input-context-builder';
import type { RuntimeLogger } from '../host-interface/runtime-logger';
import {
  SessionBranchService,
  SessionContextInputService,
  SessionService,
} from '../session';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import { createInputProcessingCompositionIds } from './input-processing-ids';
import type { AgentLoopRepository } from '../persistence/repos/agent-loop.repo';
import type { ArtifactRepository } from '../persistence/repos/artifact.repo';
import type { SessionRepository } from '../persistence/repos/session.repo';
import type { ToolCallRepository } from '../persistence/repos/tool-call.repo';
import type { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import type { ToolRegistryService } from '../tools';
import { PlanArtifactCompatibilityService, PlanArtifactService } from '../artifacts';
import type { MemoryRuntimeComposition } from './compose-coding-agent-memory';
import { PostRunHooksCoordinator } from '../hooks';
import { RunRetryCoordinator, RunTerminalCoordinator } from '../state';
import {
  createWorkspaceChangeFooterProjectorService,
  isWorkspaceChangeFooterProjectorPort,
} from '../workspace';

export interface CodingAgentHomePaths {
  homePath: string;
  sqlitePath: string;
  settingsPath: string;
}

export interface ComposeCodingAgentSessionRuntimeOptions {
  homePaths: CodingAgentHomePaths;
  runtimeLogger: RuntimeLogger;
  artifactRepository: ArtifactRepository;
  agentLoopRepository: AgentLoopRepository;
  sessionRepository: SessionRepository;
  toolCallRepository: ToolCallRepository;
  workspaceChangeRepository: WorkspaceChangeRepository;
  toolRegistry: ToolRegistryService;
  modelCallProviderService: ModelCallProvider;
  toolRuntimeFactory: ToolRuntimeFactory;
  memoryRuntime: MemoryRuntimeComposition['memoryRuntime'];
  chatStreamEventSink?: ConstructorParameters<typeof InputProcessingService>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: ConstructorParameters<typeof InputProcessingService>[0]['workspaceChanges'];
}

export function composeCodingAgentSessionRuntime(options: ComposeCodingAgentSessionRuntimeOptions) {
  const inputProcessingIds = createInputProcessingCompositionIds();
  const runContextService = new RunContextService({
    contextRepository: options.agentLoopRepository,
    workspaceSourceProvider: createLocalWorkspaceSourceProvider(),
  });
  const contextRuntime = composeCodingAgentContext({
    sessionRepository: options.sessionRepository as any,
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
  const permissionSnapshotService = new PermissionSnapshotService({
    repository: options.agentLoopRepository,
  });
  const planArtifactService = new PlanArtifactService({
    repository: options.agentLoopRepository,
    planArtifactCompatibility,
  });
  const sessionService = new SessionService({
    sessionRepository: options.sessionRepository,
    messageRepository: options.sessionRepository,
    runRepository: options.agentLoopRepository,
    ids: { sessionId: () => `session:${crypto.randomUUID()}` },
    activePathRepository: options.sessionRepository,
    timelineMessageRepository: options.agentLoopRepository,
    memorySettingsProvider: options.memoryRuntime.memorySettingsProvider,
    memoryMarkdownSyncService: options.memoryRuntime.markdownSyncService,
    megumiHomePath: options.homePaths.homePath,
  });
  const branchIds = {
    branchMarkerId: () => `branch-marker:${crypto.randomUUID()}`,
    sourceEntryId: () => `source-entry:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    chatStreamEventId: () => `chat-stream-event:${crypto.randomUUID()}`,
  };
  const sessionBranchService = new SessionBranchService({
    sessionRepository: options.sessionRepository,
    messageRepository: options.sessionRepository,
    runtimeEventRepository: options.agentLoopRepository,
    activePathRepository: options.sessionRepository,
    ids: branchIds,
    chatStreamEventSink: options.chatStreamEventSink,
  });
  const sessionContextInputService = new SessionContextInputService({
    sessionRepository: options.sessionRepository,
    messageRepository: options.sessionRepository,
    runRepository: options.agentLoopRepository,
    runExecutionFactRepository: options.agentLoopRepository,
    runtimeEventRepository: options.agentLoopRepository,
    sessionCompactionRepository: options.sessionRepository,
    activePathRepository: options.sessionRepository,
  });
  const workspaceChanges = options.workspaceChangeFooterProjector ?? options.workspaceChangeRepository;
  const workspaceChangeFooterProjector = isWorkspaceChangeFooterProjectorPort(workspaceChanges)
    ? createWorkspaceChangeFooterProjectorService({ workspaceChanges })
    : undefined;
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
    ids: inputProcessingIds,
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
    ids: inputProcessingIds,
  });
  const inputProcessingService = new InputProcessingService({
    sessionRepository: options.sessionRepository,
    agentLoopRepository: options.agentLoopRepository,
    postRunHooks,
    runTerminalCoordinator,
    runRetryCoordinator,
    promptContextService: contextRuntime.contextService,
    contextUsageMonitor: contextRuntime.contextUsageMonitor,
    activePathRepository: options.sessionRepository,
    sessionContextInputService,
    sessionBranchService,
    permissionSnapshotService,
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
    ids: inputProcessingIds,
  });
  const commandService = createCommandService();
  const inputService = createInputService({
    session: sessionService,
    userInput: inputProcessingService,
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
    sessionBranchService,
    inputService,
    inputProcessingService,
    commandService,
    planArtifactService,
  };
}
