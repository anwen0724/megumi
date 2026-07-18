/*
 * Composes the complete Megumi product from Product Home, Agent runtime,
 * Host interfaces, and host-provided capability adapters.
 */
import {
  composeAgentRuntime,
  type ComposeAgentRuntimeOptions,
} from '@megumi/agent/composition';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from '../home';
import { createApprovalHost } from '../host-interface/approval-host';
import { createArtifactHost } from '../host-interface/artifact-host';
import { createChatHost, type ImagePickerPort } from '../host-interface/chat-host';
import { createPlanHost } from '../host-interface/plan-host';
import type { ProductHostInterface } from '../host-interface/product-host-interface';
import { createSettingsHost } from '../host-interface/settings-host';
import { createSkillHost } from '../host-interface/skill-host';
import { createWorkspaceHost, type DirectoryPickerPort, type FileOpenPort } from '../host-interface/workspace-host';
import { createObservabilityHost, type DiagnosticBundleSavePort } from '../host-interface/observability-host';
import {
  createObservabilityRuntimeLogger,
  type RuntimeLogClockPort,
  type RuntimeLogWriterPort,
} from '../logging';
import type { RuntimeLogger } from '@megumi/agent/composition';
import { composeObservability, type ObservabilityStorage } from '@megumi/observability';

export type ComposeProductOptions = Omit<
  ComposeAgentRuntimeOptions,
  'homePaths' | 'runtimeLogger'
> & {
  home: InitializeMegumiHomeSyncOptions;
  logWriter?: RuntimeLogWriterPort;
  logClock?: RuntimeLogClockPort;
  observabilityStorage?: ObservabilityStorage;
  productEnvironment?: { appVersion: string; platform: string; arch: string };
  diagnosticBundleSave?: DiagnosticBundleSavePort;
  directoryPicker?: DirectoryPickerPort;
  fileOpen?: FileOpenPort;
  imagePicker?: ImagePickerPort;
};

/** Host capabilities implemented by shells without importing Agent internals. */
export type ProductInputFileReader = NonNullable<ComposeProductOptions['inputFileReader']>;
export type ProductSessionAttachmentFileSystem = NonNullable<ComposeProductOptions['sessionAttachmentFileSystem']>;

export interface ProductRuntime {
  homePaths: MegumiHomePaths;
  host: ProductHostInterface;
  logger: RuntimeLogger;
  observability: ReturnType<typeof composeObservability>;
  dispose(): void;
}

export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const homePaths = initializeMegumiHomeSync(options.home);
  const observability = composeObservability({
    directoryPath: `${homePaths.logsPath}/observability`,
    storage: options.observabilityStorage ?? noopObservabilityStorage,
    appVersion: options.productEnvironment?.appVersion ?? 'unknown',
    platform: options.productEnvironment?.platform ?? 'unknown',
    arch: options.productEnvironment?.arch ?? 'unknown',
    now: options.logClock?.now,
  });
  const logger = createObservabilityRuntimeLogger(observability.service);
  const runtime = composeAgentRuntime({
    ...agentOptions(options),
    homePaths: {
      homePath: homePaths.homePath,
      sqlitePath: homePaths.sqlitePath,
      settingsPath: homePaths.settingsPath,
      attachmentsPath: homePaths.attachmentsPath,
    },
    runtimeLogger: logger,
    observabilityService: observability.service,
  });
  const artifacts = createArtifactHost(runtime.artifactService);
  const host: ProductHostInterface = {
    chat: createChatHost({
      agentRunService: runtime.agentRunService,
      commandService: runtime.commandService,
      sessionService: runtime.sessionService,
      workspaceService: runtime.workspaceService,
      branchService: runtime.sessionBranchService,
      sessionTimelineQuery: runtime.sessionTimelineQuery,
      contextService: runtime.contextRuntime.contextService,
      ...(options.imagePicker ? { imagePicker: options.imagePicker } : {}),
    }),
    skill: createSkillHost(runtime.skillService),
    workspace: createWorkspaceHost({
      workspaceService: runtime.workspaceService,
      workspaceFilesService: runtime.workspaceFilesService,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
      ...(options.fileOpen ? { fileOpen: options.fileOpen } : {}),
    }),
    settings: createSettingsHost(runtime.settingsService),
    approval: createApprovalHost(runtime.agentRunService),
    artifacts,
    plan: createPlanHost(runtime.planArtifactService),
    observability: createObservabilityHost(observability.queryService, options.diagnosticBundleSave),
  };

  return {
    homePaths,
    host,
    logger,
    observability,
    dispose: () => { void observability.flush(); runtime.dispose(); },
  };
}

function agentOptions(
  options: ComposeProductOptions,
): Omit<ComposeAgentRuntimeOptions, 'homePaths' | 'runtimeLogger'> {
  const {
    home: _home,
    logWriter: _logWriter,
    logClock: _logClock,
    observabilityStorage: _observabilityStorage,
    productEnvironment: _productEnvironment,
    diagnosticBundleSave: _diagnosticBundleSave,
    directoryPicker: _directoryPicker,
    fileOpen: _fileOpen,
    imagePicker: _imagePicker,
    ...agent
  } = options;
  return agent;
}

const noopObservabilityStorage: ObservabilityStorage = {
  ensureDirectory: async () => undefined,
  appendText: async () => undefined,
  readText: async () => '',
  listFiles: async () => [],
  stat: async () => undefined,
  move: async () => undefined,
  remove: async () => undefined,
};
