// Composes the complete Coding Agent host interface without depending on any UI shell.
import { ArtifactContentStore } from '../artifacts/artifact-content-store';
import { ArtifactService } from '../artifacts';
import { createCodingAgentHostInterface, type CodingAgentHostInterface } from '../host-interface';
import { createArtifactController } from '../host-interface/artifacts/artifact-controller';
import { createPlanController } from '../host-interface/artifacts/plan-controller';
import { createApprovalController } from '../host-interface/permissions/approval-controller';
import { ApprovalResolutionService } from '../host-interface/permissions/approval-resolution-service';
import { createProviderController } from '../host-interface/settings/provider-controller';
import { createSettingsController } from '../host-interface/settings/settings-controller';
import { createSessionBranchController } from '../host-interface/session/branch-controller';
import { createSessionController } from '../host-interface/session/session-controller';
import { createWorkspaceController } from '../host-interface/workspace/workspace-controller';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { composeCodingAgentToolRegistryService, composeCodingAgentToolRuntimeFactory } from './compose-coding-agent-tool-runtime';
import { composeCodingAgentSessionRuntime, type CodingAgentHomePaths } from './compose-coding-agent-session-runtime';
import { composeCodingAgentMemory } from './compose-coding-agent-memory';
import { composeCodingAgentRecoveryRuntime } from './compose-coding-agent-recovery-runtime';
import type { RuntimeLogger } from '../host-interface/runtime-logger';
import type { ModelCallProvider, ModelCallRuntimeResolverPort } from '../agent-loop/model-call';
import {
  createAiClient,
  createAnthropicProviderAdapter,
  createDeepSeekProviderAdapter,
  createOpenAICompatibleProviderAdapter,
  createOpenAIProviderAdapter,
  ProviderRegistry,
  type AiClient,
} from '@megumi/ai';
import { createModelCallRunner, type ProviderRuntimeConfig } from '../agent-loop/model-call';
import { TimelineHistoryCommitProjectorService } from '../projections/timeline';
import {
  createSettingsService,
  ProviderRuntimeResolutionError,
  type MemorySettingsPort,
  type SettingsFileStore,
  type SettingsService,
} from '../settings';
import {
  createWorkspaceChangeService,
  createWorkspacePathPolicyService,
  createWorkspaceService,
} from '../workspace';
import type { DirectoryPickerPort } from '../host-interface/workspace/workspace-controller';
import { createLocalSettingsJsonStorage } from '../adapters/local/settings/settings-json-storage';
import {
  createLocalProjectFileSystem,
  type LocalWorkspaceServiceFileSystem,
} from '../adapters/local/workspace/project-file-system';

export interface ComposeCodingAgentRuntimeOptions {
  homePaths: CodingAgentHomePaths;
  migrationsFolder?: string;
  runtimeLogger: RuntimeLogger;
  // Optional override for tests / alternative entries. When omitted, the product
  // builds a real OpenAI-compatible model call provider so it runs standalone.
  modelCallProviderService?: ModelCallProvider;
  appSettingsProvider?: unknown;
  memorySettingsProvider?: MemorySettingsPort;
  permissionSettingsProvider?: unknown;
  chatStreamEventSink?: Parameters<typeof composeCodingAgentSessionRuntime>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: Parameters<typeof composeCodingAgentSessionRuntime>[0]['workspaceChangeFooterProjector'];
  // Optional UI-shell hooks for project lifecycle. Omitted in standalone/non-UI
  // runs: the picker defaults to a no-op (cancels) and the file system to node fs.
  directoryPicker?: DirectoryPickerPort;
  projectFileSystem?: LocalWorkspaceServiceFileSystem;
  settingsStorage?: SettingsFileStore;
}

export function composeCodingAgentRuntime(options: ComposeCodingAgentRuntimeOptions): CodingAgentHostInterface {
  const persistence = composeCodingAgentPersistence({
    sqlitePath: options.homePaths.sqlitePath,
    migrationsFolder: options.migrationsFolder,
  });
  const agentLoopRepository = persistence.agentLoopRepository as any;
  const sessionRepository = persistence.sessionRepository as any;
  const toolCallRepository = persistence.toolCallRepository as any;
  const toolRegistry = composeCodingAgentToolRegistryService();
  const settingsService = resolveSettingsService(options.appSettingsProvider) ?? createSettingsService({
    file_store: options.settingsStorage ?? createLocalSettingsJsonStorage({
      settingsPath: options.homePaths.settingsPath,
    }),
    env: process.env,
  });
  const modelCallProviderService = options.modelCallProviderService
    ?? createModelCallRunner({
      resolver: createModelCallRuntimeResolver(settingsService),
      aiClientFactory: ({ config }) => createAiClientForProviderRuntime(config),
    });
  const memory = composeCodingAgentMemory({
    repository: persistence.memoryRepository,
    modelStepProvider: modelCallProviderService,
    memorySettingsProvider: options.memorySettingsProvider ?? {
      isMemoryEnabled: () => {
        const result = settingsService.getResolvedSettings();
        return result.status === 'ok' ? result.settings.memory.enabled : false;
      },
    },
    runtimeLogger: options.runtimeLogger,
    megumiHomePath: options.homePaths.homePath,
  });
  const workspaceFileSystem = options.projectFileSystem ?? createLocalProjectFileSystem();
  const workspacePathPolicyService = createWorkspacePathPolicyService();
  const workspaceService = createWorkspaceService({
    repository: persistence.workspaceRepository,
    file_system: workspaceFileSystem,
  });
  const workspaceChangeService = createWorkspaceChangeService({
    repository: persistence.workspaceChangeRepository,
    path_policy: workspacePathPolicyService,
    file_system: workspaceFileSystem,
  });
  const toolRuntimeFactory = composeCodingAgentToolRuntimeFactory({
    toolRepository: toolCallRepository,
    toolRegistry,
    workspaceChangeService,
    workspacePathPolicyService,
    runRepository: agentLoopRepository,
    permissionSettingsResolver: resolvePermissionSettingsResolver(options.permissionSettingsProvider) ?? settingsService,
  });
  // Persist committed timeline history in the product, forwarding events to any
  // caller-provided sink (e.g. the desktop UI bridge) downstream. This keeps
  // history persistence working even without a UI.
  const chatStreamEventSink = new TimelineHistoryCommitProjectorService({
    repository: agentLoopRepository,
    downstream: options.chatStreamEventSink,
    ids: { diagnosticId: () => `timeline-commit-diagnostic:${crypto.randomUUID()}` },
  });
  const sessionRuntime = composeCodingAgentSessionRuntime({
    homePaths: options.homePaths,
    database: persistence.database,
    runtimeLogger: options.runtimeLogger,
    artifactRepository: persistence.artifactRepository,
    agentLoopRepository,
    sessionRepository,
    toolCallRepository,
    workspaceChangeService,
    toolRegistry,
    modelCallProviderService,
    toolRuntimeFactory,
    memoryRuntime: memory.memoryRuntime,
    chatStreamEventSink,
    workspaceChangeFooterProjector: options.workspaceChangeFooterProjector,
  });
  const approvalResolutionService = new ApprovalResolutionService({
    repository: toolCallRepository,
    resumeApproval: (request) => sessionRuntime.agentRunProcessingService.resumeToolApproval(request),
  });
  const artifactContentStore = new ArtifactContentStore({
    artifactRoot: `${options.homePaths.homePath}/artifacts`,
  });
  const artifactService = new ArtifactService({
    repository: persistence.artifactRepository,
    contentStore: artifactContentStore,
  });
  const recoveryService = composeCodingAgentRecoveryRuntime({
    recoveryRepository: agentLoopRepository,
    runRepository: agentLoopRepository,
    sessionRepository: sessionRepository,
    runtimeEventRepository: agentLoopRepository,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    timelineMessageRepository: agentLoopRepository,
    logger: options.runtimeLogger,
  });
  const settings = createSettingsController(settingsService);
  const artifacts = createArtifactController(artifactService);

  return createCodingAgentHostInterface({
    input: sessionRuntime.agentRunService,
    commands: sessionRuntime.commandService,
    workspace: createWorkspaceController({
      workspaceService,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
    }),
    session: {
      ...createSessionController(sessionRuntime.sessionService, {
        listWorkspaceIds: () => persistence.workspaceRepository.listWorkspaces().map((workspace) => workspace.workspace_id),
        listTimelineMessagesBySession: (payload) => agentLoopRepository.listCommittedMessagesBySession(payload),
        listRunsBySession: (sessionId) => agentLoopRepository.listRunsBySession(sessionId),
      }),
      ...createSessionBranchController(sessionRuntime.sessionBranchService),
    },
    settings: {
      ...settings,
      provider: createProviderController(settingsService),
    },
    permissions: createApprovalController(approvalResolutionService),
    artifacts: {
      ...artifacts,
      plan: createPlanController(sessionRuntime.planArtifactService),
    },
    dispose: () => persistence.database.close(),
  });
}

function createAiClientForProviderRuntime(config: ProviderRuntimeConfig): AiClient {
  return createAiClient({
    registry: new ProviderRegistry([createProviderAdapterForRuntimeConfig(config)]),
  });
}

function createProviderAdapterForRuntimeConfig(config: ProviderRuntimeConfig) {
  switch (config.providerId) {
    case 'openai':
      return createOpenAIProviderAdapter({
        baseUrl: requireBaseUrl(config),
        fetch,
      });
    case 'deepseek':
      return createDeepSeekProviderAdapter({
        baseUrl: requireBaseUrl(config),
        fetch,
      });
    case 'custom':
      return createOpenAICompatibleProviderAdapter({
        providerId: 'custom',
        baseUrl: requireBaseUrl(config),
        fetch,
      });
    case 'anthropic':
      return createAnthropicProviderAdapter({
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        fetch,
      });
  }
}

function requireBaseUrl(config: ProviderRuntimeConfig): string {
  if (!config.baseUrl) {
    throw new Error(`Provider base URL is required: ${config.providerId}`);
  }

  return config.baseUrl;
}

function createModelCallRuntimeResolver(settingsService: SettingsService): ModelCallRuntimeResolverPort {
  return {
    async resolveProviderRuntimeConfig(input) {
      const result = settingsService.resolveProviderRuntimeConfig({
        provider_id: input.providerId,
        model_id: input.modelId ?? '',
      });

      if (result.status === 'failed') {
        throw new ProviderRuntimeResolutionError({
          code: result.failure.code as any,
          message: result.failure.message,
          severity: 'error',
          retryable: false,
          source: 'provider',
          ...(input.runtimeContext?.debugId ? { debugId: input.runtimeContext.debugId } : {}),
          details: result.failure.details as any,
        });
      }

      return {
        providerId: result.config.provider_id as ProviderRuntimeConfig['providerId'],
        kind: result.config.kind === 'openai' ? 'openai-compatible' : result.config.kind,
        ...(result.config.base_url ? { baseUrl: result.config.base_url } : {}),
        apiKey: result.config.api_key ?? '',
        defaultModelId: result.config.model_id,
      };
    },
  };
}

function resolveSettingsService(value: unknown): SettingsService | undefined {
  return hasSettingsServiceShape(value) ? value : undefined;
}

function hasSettingsServiceShape(value: unknown): value is SettingsService {
  return Boolean(
    value
    && typeof value === 'object'
    && 'resolveProviderRuntimeConfig' in value
    && 'resolvePermissionSettings' in value
    && 'getResolvedSettings' in value,
  );
}

function resolvePermissionSettingsResolver(value: unknown): Pick<SettingsService, 'resolvePermissionSettings'> | undefined {
  return Boolean(value && typeof value === 'object' && 'resolvePermissionSettings' in value)
    ? value as Pick<SettingsService, 'resolvePermissionSettings'>
    : undefined;
}

export function composeCodingAgentHostInterface(
  options: ComposeCodingAgentRuntimeOptions,
): CodingAgentHostInterface {
  return composeCodingAgentRuntime(options);
}
