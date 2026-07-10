/*
 * Composes the complete Megumi product from Product Home, Coding Agent runtime,
 * Host interfaces, and host-provided capability adapters.
 */
import {
  composeCodingAgentRuntime,
  type ComposeCodingAgentRuntimeOptions,
} from '@megumi/coding-agent/composition';
import { createSessionBranchService } from '@megumi/coding-agent/session';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from '../home';
import { createApprovalHost } from '../host-interface/approval-host';
import { createArtifactHost } from '../host-interface/artifact-host';
import { createChatHost } from '../host-interface/chat-host';
import { createPlanHost } from '../host-interface/plan-host';
import type { ProductHostInterface } from '../host-interface/product-host-interface';
import { createSettingsHost } from '../host-interface/settings-host';
import { createSkillHost } from '../host-interface/skill-host';
import { createWorkspaceHost, type DirectoryPickerPort, type FileOpenPort } from '../host-interface/workspace-host';
import {
  createProductRuntimeLogger,
  type RuntimeLogClockPort,
  type RuntimeLogWriterPort,
} from '../logging';
import type { RuntimeLogger } from '@megumi/coding-agent/composition';

export type ComposeProductOptions = Omit<
  ComposeCodingAgentRuntimeOptions,
  'homePaths' | 'runtimeLogger'
> & {
  home: InitializeMegumiHomeSyncOptions;
  logWriter: RuntimeLogWriterPort;
  logClock?: RuntimeLogClockPort;
  directoryPicker?: DirectoryPickerPort;
  fileOpen?: FileOpenPort;
};

export interface ProductRuntime {
  homePaths: MegumiHomePaths;
  host: ProductHostInterface;
  logger: RuntimeLogger;
  dispose(): void;
}

export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const homePaths = initializeMegumiHomeSync(options.home);
  const logger = createProductRuntimeLogger({
    logsPath: homePaths.logsPath,
    writer: options.logWriter,
    clock: options.logClock ?? { now: () => new Date() },
  });
  const runtime = composeCodingAgentRuntime({
    ...codingAgentOptions(options),
    homePaths: {
      homePath: homePaths.homePath,
      sqlitePath: homePaths.sqlitePath,
      settingsPath: homePaths.settingsPath,
    },
    runtimeLogger: logger,
  });
  const artifacts = createArtifactHost(runtime.artifactService);
  const host: ProductHostInterface = {
    chat: createChatHost({
      agentRunService: runtime.agentRunService,
      commandService: runtime.commandService,
      sessionService: runtime.sessionService,
      workspaceService: runtime.workspaceService,
      branchService: createSessionBranchService(),
      sessionTimelineQuery: runtime.sessionTimelineQuery,
      agentRunQueries: runtime.agentRunQueries,
      contextUsageMonitor: runtime.contextRuntime.contextUsageMonitor,
      contextUsageWindowProvider: runtime.contextUsageWindowProvider,
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
  };

  return {
    homePaths,
    host,
    logger,
    dispose: runtime.dispose,
  };
}

function codingAgentOptions(
  options: ComposeProductOptions,
): Omit<ComposeCodingAgentRuntimeOptions, 'homePaths' | 'runtimeLogger'> {
  const {
    home: _home,
    logWriter: _logWriter,
    logClock: _logClock,
    directoryPicker: _directoryPicker,
    fileOpen: _fileOpen,
    ...codingAgent
  } = options;
  return codingAgent;
}
