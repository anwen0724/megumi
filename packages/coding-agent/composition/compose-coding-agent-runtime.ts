// Composes the complete Coding Agent product runtime without depending on any UI shell.
import { ArtifactContentStore } from '../artifacts/artifact-content-store';
import { ArtifactService } from '../artifacts';
import { createCodingAgentProductRuntime, type CodingAgentProductRuntime } from '../product-runtime';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import { composeCodingAgentToolRegistry, composeCodingAgentToolRuntimeFactory, composeCodingAgentToolService } from './compose-coding-agent-tool-runtime';
import { composeCodingAgentSessionRuntime, type CodingAgentHomePaths } from './compose-coding-agent-session-runtime';
import { composeCodingAgentMemory } from './compose-coding-agent-memory';
import { composeCodingAgentRecoveryRuntime } from './compose-coding-agent-recovery-runtime';
import type { RuntimeLogger } from '../product-runtime';
import type { ModelCallProvider } from '../agent-loop/model-call';
import {
  createAiClient,
  createAnthropicProviderAdapter,
  createDeepSeekProviderAdapter,
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
import { createLocalProjectFileSystem } from '../adapters/local/workspace/project-file-system';

export interface ComposeCodingAgentRuntimeOptions {
  homePaths: CodingAgentHomePaths;
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

export function composeCodingAgentRuntime(options: ComposeCodingAgentRuntimeOptions): CodingAgentProductRuntime {
  const persistence = composeCodingAgentPersistence({ sqlitePath: options.homePaths.sqlitePath });
  const toolRegistry = composeCodingAgentToolRegistry();
  const settingsService = new ProductSettingsService({
    storage: options.settingsStorage ?? createVolatileProductSettingsStorage(),
  });
  const providerSettingsService = new ProviderSettingsService({
    settings: options.appSettingsProvider ?? settingsService,
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
      isMemoryEnabled: () => settingsService.getMemorySettings().enabled,
    },
    runtimeLogger: options.runtimeLogger,
    megumiHomePath: options.homePaths.homePath,
  });
  const toolRuntimeFactory = composeCodingAgentToolRuntimeFactory({
    toolRepository: persistence.toolRepository,
    toolRegistry,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    runRepository: persistence.runRecordRepository,
    permissionSettingsProvider: options.permissionSettingsProvider ?? settingsService,
  });
  // Persist committed timeline history in the product, forwarding events to any
  // caller-provided sink (e.g. the desktop UI bridge) downstream. This keeps
  // history persistence working even without a UI.
  const chatStreamEventSink = new TimelineHistoryCommitProjectorService({
    repository: persistence.timelineMessageRepository,
    downstream: options.chatStreamEventSink,
    ids: { diagnosticId: () => `timeline-commit-diagnostic:${crypto.randomUUID()}` },
  });
  const sessionRuntime = composeCodingAgentSessionRuntime({
    homePaths: options.homePaths,
    runtimeLogger: options.runtimeLogger,
    artifactRepository: persistence.artifactRepository,
    permissionSnapshotRepository: persistence.permissionSnapshotRepository,
    modelStepRepository: persistence.modelStepRepository,
    runRecordRepository: persistence.runRecordRepository,
    sessionRecordRepository: persistence.sessionRecordRepository,
    sessionContextRepository: persistence.sessionContextRepository,
    sessionMessageRepository: persistence.sessionMessageRepository,
    runExecutionFactRepository: persistence.runExecutionFactRepository,
    runtimeEventRepository: persistence.runtimeEventRepository,
    activePathRepository: persistence.activePathRepository,
    toolRepository: persistence.toolRepository,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    timelineMessageRepository: persistence.timelineMessageRepository,
    toolRegistry,
    modelCallProviderService,
    toolRuntimeFactory,
    memoryRuntime: memory.memoryRuntime,
    runContextRepository: persistence.runContextRepository,
    chatStreamEventSink,
    workspaceChangeFooterProjector: options.workspaceChangeFooterProjector,
  });
  const toolService = composeCodingAgentToolService({
    toolRegistry,
    toolRepository: persistence.toolRepository,
    resumeApproval: (request) => sessionRuntime.agentRunService.resumeApproval(request),
  });
  const artifactContentStore = new ArtifactContentStore({
    artifactRoot: `${options.homePaths.homePath}/artifacts`,
  });
  const artifactService = new ArtifactService({
    repository: persistence.artifactRepository,
    contentStore: artifactContentStore,
  });
  const recoveryService = composeCodingAgentRecoveryRuntime({
    recoveryRepository: persistence.recoveryRepository,
    runRepository: persistence.runRecordRepository,
    sessionRepository: persistence.sessionRecordRepository,
    runtimeEventRepository: persistence.runtimeEventRepository,
    workspaceChangeRepository: persistence.workspaceChangeRepository,
    timelineMessageRepository: persistence.timelineMessageRepository,
    sessionRunService: sessionRuntime.agentRunService,
    logger: options.runtimeLogger,
  });
  const projectService = createProjectService({
    repository: persistence.projectRepository,
    fileSystem: options.projectFileSystem ?? createLocalProjectFileSystem(),
    ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
  });

  return createCodingAgentProductRuntime({
    sessionService: sessionRuntime.sessionService,
    sessionBranchService: sessionRuntime.sessionBranchService,
    agentRunService: sessionRuntime.agentRunService,
    recoveryService,
    toolService,
    artifactService,
    planArtifactService: sessionRuntime.planArtifactService,
    memoryService: memory.memoryService,
    runContextService: sessionRuntime.runContextService,
    settingsService,
    providerSettingsService,
    projectService,
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
