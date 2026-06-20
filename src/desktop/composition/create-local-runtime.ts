// Composes the local desktop runtime by wiring src owner modules behind AppApi's AgentRuntimePort.
import path from 'node:path';
import { stream as streamAssistantMessage, type Model } from '../../ai';
import type { AgentAiClient } from '../../agent';
import { evaluatePermissionPolicy } from '../../permission';
import { createSessionStateManager } from '../../session';
import { createBuiltInToolRegistry, createToolExecutionService } from '../../tools';
import {
  createWorkspace,
  createWorkspaceManager,
  createWorkspaceRootAuthorization,
} from '../../workspace';
import { createDesktopAgentRuntimeService } from '../services/agent-runtime-service';
import { createTimelineHistoryCommitService } from '../services/timeline-history-commit-service';
import { createHostAdapters } from './create-host-adapters';
import { createProviderRegistry } from './create-provider-registry';
import { createRuntimeEventBus } from './create-runtime-event-bus';
import { createRuntimeInfrastructure } from './create-runtime-infrastructure';
import { createToolProcessHost } from './create-tool-process-host';
import { createWorkspaceFileHost } from './create-workspace-file-host';
import type { CreateLocalDesktopRuntimeOptions, LocalDesktopRuntime } from './local-runtime-types';
import { createStableId } from './runtime-id';

export type { CreateLocalDesktopRuntimeOptions, LocalDesktopRuntime } from './local-runtime-types';

const defaultModel: Model = { providerId: 'desktop-unconfigured', modelId: 'desktop-unconfigured' };

export function createLocalDesktopRuntime(options: CreateLocalDesktopRuntimeOptions = {}): LocalDesktopRuntime {
  const eventBus = options.eventBus ?? createRuntimeEventBus();
  const hosts = options.hosts ?? createHostAdapters();
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? createStableId;
  const infrastructure = createRuntimeInfrastructure({ hosts, databasePath: options.databasePath, now });
  const sessionManager = createSessionStateManager({
    repository: infrastructure.sessionRepository,
    now,
    createId,
  });
  const permissionEvaluator = { evaluate: evaluatePermissionPolicy };
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const workspace = createWorkspace({
    id: 'workspace-local',
    projectRoot: workspaceRoot,
    name: path.basename(workspaceRoot),
    createdAt: now(),
    updatedAt: now(),
  });
  const workspaceManager = createWorkspaceManager({
    workspace,
    fileHost: createWorkspaceFileHost(workspaceRoot),
    repository: infrastructure.workspaceRepository,
    now,
    createId,
    rootAuthorization: createWorkspaceRootAuthorization({
      workspace,
      allowedRoots: [workspaceRoot],
      currentWorkingDirectory: workspaceRoot,
      createdAt: now(),
    }),
  });
  const toolRegistry = createBuiltInToolRegistry();
  const toolExecutionService = createToolExecutionService({
    registry: toolRegistry,
    workspace: workspaceManager,
    processHost: createToolProcessHost(hosts),
    executionRepository: infrastructure.toolExecutionRepository,
    now,
    createId,
  });
  const ai: AgentAiClient = options.ai ?? {
    stream(model, context, aiOptions, toolSet) {
      return streamAssistantMessage(model, context, aiOptions, toolSet);
    },
  };
  const timelineHistoryCommitService = createTimelineHistoryCommitService({
    repository: infrastructure.timelineMessageRepository,
    createDiagnosticId: () => createId('timeline-diagnostic', now()),
  });
  const agentRuntimeService = createDesktopAgentRuntimeService({
    eventBus,
    sessionRepository: infrastructure.sessionRepository,
    sessionManager,
    permissionRepository: infrastructure.permissionRepository,
    permissionEvaluator,
    toolRegistry,
    toolExecutionService,
    runtimeEventRepository: infrastructure.runtimeEventRepository,
    recoveryRepository: infrastructure.recoveryRepository,
    timelineHistoryCommitService,
    settingsStore: infrastructure.settingsStore,
    providerSettingsStore: infrastructure.providerSettingsStore,
    ai,
    model: options.model ?? defaultModel,
    aiOptions: options.aiOptions ?? {
      registry: createProviderRegistry(infrastructure.providerSettingsStore),
      credentialResolver: infrastructure.providerSettingsStore,
    },
    systemInstruction: options.systemInstruction ?? 'You are Megumi.',
    now,
    createId,
  });

  return {
    agentRuntime: agentRuntimeService.agentRuntime,
    eventBus,
    hosts,
    database: infrastructure.database,
    megumiHomePaths: infrastructure.megumiHomePaths,
    settingsStore: infrastructure.settingsStore,
    providerSettingsStore: infrastructure.providerSettingsStore,
    projectRepository: infrastructure.projectRepository,
    runtimeEventRepository: infrastructure.runtimeEventRepository,
    timelineMessageRepository: infrastructure.timelineMessageRepository,
    recoveryRepository: infrastructure.recoveryRepository,
    runtimeLogger: infrastructure.runtimeLogger,
    sessionRepository: infrastructure.sessionRepository,
    sessionManager,
    permissionRepository: infrastructure.permissionRepository,
    permissionEvaluator,
    toolRegistry,
    toolExecutionService,
    toolExecutionRepository: infrastructure.toolExecutionRepository,
    workspaceRepository: infrastructure.workspaceRepository,
    workspaceManager,
    async start() {},
    async stop() {
      agentRuntimeService.dispose();
      timelineHistoryCommitService.dispose();
      infrastructure.database.close();
    },
  };
}
