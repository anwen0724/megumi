// Composes the complete Coding Agent host interface without depending on any UI shell.
import { ArtifactContentStore } from '../artifacts/artifact-content-store';
import { ArtifactService } from '../artifacts';
import { createCodingAgentHostInterface, type CodingAgentHostInterface } from '../host-interface';
import { createArtifactController } from '../host-interface/artifacts/artifact-controller';
import { createPlanController } from '../host-interface/artifacts/plan-controller';
import { createApprovalController } from '../host-interface/permissions/approval-controller';
import { createProviderController } from '../host-interface/settings/provider-controller';
import { createSettingsController } from '../host-interface/settings/settings-controller';
import { createSessionBranchController } from '../host-interface/session/branch-controller';
import { createSessionController } from '../host-interface/session/session-controller';
import { createWorkspaceController } from '../host-interface/workspace/workspace-controller';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { composeCodingAgentToolRegistry, composeCodingAgentToolRuntimeFactory, composeCodingAgentToolService } from './compose-coding-agent-tool-runtime';
import { composeCodingAgentSessionRuntime, type CodingAgentHomePaths } from './compose-coding-agent-session-runtime';
import { composeCodingAgentMemory } from './compose-coding-agent-memory';
import { composeCodingAgentRecoveryRuntime } from './compose-coding-agent-recovery-runtime';
import type { RuntimeLogger } from '../host-interface/runtime-logger';
import type { ModelCallProvider } from '../agent-loop/model-call';
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
import type { PermissionSettingsProvider } from '../permissions/permission-settings-provider';
import {
  ProductSettingsService,
  ProviderRuntimeService,
  ProviderSettingsService,
  type MemorySettingsPort,
  type ProductSettingsStoragePort,
  type ProviderSettingsProductSettingsPort,
} from '../settings';
import {
  createProjectService,
  type DirectoryPickerPort,
  type ProjectFileSystem,
} from '../workspace';
import { createLocalSettingsJsonStorage } from '../adapters/local/settings/settings-json-storage';
import { createLocalProjectFileSystem } from '../adapters/local/workspace/project-file-system';

export interface ComposeCodingAgentRuntimeOptions {
  homePaths: CodingAgentHomePaths;
  migrationsFolder?: string;
  runtimeLogger: RuntimeLogger;
  // Optional override for tests / alternative entries. When omitted, the product
  // builds a real OpenAI-compatible model call provider so it runs standalone.
  modelCallProviderService?: ModelCallProvider;
  appSettingsProvider?: ProviderSettingsProductSettingsPort;
  memorySettingsProvider?: MemorySettingsPort;
  permissionSettingsProvider?: PermissionSettingsProvider;
  chatStreamEventSink?: Parameters<typeof composeCodingAgentSessionRuntime>[0]['chatStreamEventSink'];
  workspaceChangeFooterProjector?: Parameters<typeof composeCodingAgentSessionRuntime>[0]['workspaceChangeFooterProjector'];
  // Optional UI-shell hooks for project lifecycle. Omitted in standalone/non-UI
  // runs: the picker defaults to a no-op (cancels) and the file system to node fs.
  directoryPicker?: DirectoryPickerPort;
  projectFileSystem?: ProjectFileSystem;
  settingsStorage?: ProductSettingsStoragePort;
}

export function composeCodingAgentRuntime(options: ComposeCodingAgentRuntimeOptions): CodingAgentHostInterface {
  const persistence = composeCodingAgentPersistence({
    sqlitePath: options.homePaths.sqlitePath,
    migrationsFolder: options.migrationsFolder,
  });
  const agentLoopRepository = persistence.agentLoopRepository as any;
  const sessionRepository = persistence.sessionRepository as any;
  const toolCallRepository = persistence.toolCallRepository as any;
  const toolRegistry = composeCodingAgentToolRegistry();
  const settingsService = new ProductSettingsService({
    storage: options.settingsStorage ?? createLocalSettingsJsonStorage({
      settingsPath: options.homePaths.settingsPath,
    }),
  });
  const effectiveSettingsProvider = options.appSettingsProvider ?? settingsService;
  const providerSettingsService = new ProviderSettingsService({
    settings: effectiveSettingsProvider,
    env: process.env,
  });
  const modelCallProviderService = options.modelCallProviderService
    ?? createModelCallRunner({
      resolver: new ProviderRuntimeService({ settings: providerSettingsService, env: process.env }),
      aiClientFactory: ({ config }) => createAiClientForProviderRuntime(config),
    });
  const memory = composeCodingAgentMemory({
    repository: persistence.memoryRepository,
    modelStepProvider: modelCallProviderService,
    memorySettingsProvider: options.memorySettingsProvider ?? {
      isMemoryEnabled: () => effectiveSettingsProvider.getResolvedSettings().memory.enabled,
    },
    runtimeLogger: options.runtimeLogger,
    megumiHomePath: options.homePaths.homePath,
  });
  const toolRuntimeFactory = composeCodingAgentToolRuntimeFactory({
    toolRepository: toolCallRepository,
    toolRegistry,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    runRepository: agentLoopRepository,
    permissionSettingsProvider: options.permissionSettingsProvider ?? settingsService,
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
    runtimeLogger: options.runtimeLogger,
    artifactRepository: persistence.artifactRepository,
    agentLoopRepository,
    sessionRepository,
    toolCallRepository,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    toolRegistry,
    modelCallProviderService,
    toolRuntimeFactory,
    memoryRuntime: memory.memoryRuntime,
    chatStreamEventSink,
    workspaceChangeFooterProjector: options.workspaceChangeFooterProjector,
  });
  const toolService = composeCodingAgentToolService({
    toolRegistry,
    toolRepository: toolCallRepository,
    resumeApproval: (request) => sessionRuntime.inputProcessingService.resumeToolApproval(request),
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
  const projectService = createProjectService({
    repository: persistence.workspaceRepository,
    fileSystem: options.projectFileSystem ?? createLocalProjectFileSystem(),
    ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
  });

  const settings = createSettingsController(effectiveSettingsProvider);
  const artifacts = createArtifactController(artifactService);

  return createCodingAgentHostInterface({
    input: sessionRuntime.inputService,
    workspace: createWorkspaceController({
      projectService,
      recoveryService,
    }),
    session: {
      ...createSessionController(sessionRuntime.sessionService),
      ...createSessionBranchController(sessionRuntime.sessionBranchService),
    },
    settings: {
      ...settings,
      provider: createProviderController(providerSettingsService),
    },
    permissions: createApprovalController(toolService),
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

function createVolatileProductSettingsStorage(): ProductSettingsStoragePort {
  let rawSettings: ReturnType<ProductSettingsStoragePort['readRawSettings']> = {};
  return {
    readRawSettings: () => rawSettings,
    writeRawSettings: (next) => {
      rawSettings = next;
    },
  };
}

export function composeCodingAgentHostInterface(
  options: ComposeCodingAgentRuntimeOptions,
): CodingAgentHostInterface {
  return composeCodingAgentRuntime(options);
}
