/*
 * Composes the complete Megumi product from Product Home, Coding Agent runtime,
 * Host interfaces, and host-provided capability adapters.
 */
import {
  composeCodingAgentRuntime,
  type ComposeCodingAgentRuntimeOptions,
  type RuntimeLogger,
} from '@megumi/coding-agent/composition';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from '../home';
import { createApprovalHost } from '../host-interface/approval-host';
import { createArtifactHost } from '../host-interface/artifact-host';
import { createChatHost, type SessionBranchHostPort } from '../host-interface/chat-host';
import { createPlanHost } from '../host-interface/plan-host';
import type { ProductHostInterface } from '../host-interface/product-host-interface';
import { createSettingsHost } from '../host-interface/settings-host';
import { createSkillHost } from '../host-interface/skill-host';
import { createWorkspaceHost, type DirectoryPickerPort } from '../host-interface/workspace-host';

export type ComposeProductOptions = Omit<
  ComposeCodingAgentRuntimeOptions,
  'homePaths' | 'runtimeLogger'
> & {
  home: InitializeMegumiHomeSyncOptions;
  runtimeLoggerFactory(homePaths: MegumiHomePaths): RuntimeLogger;
  directoryPicker?: DirectoryPickerPort;
};

export interface ProductRuntime {
  homePaths: MegumiHomePaths;
  host: ProductHostInterface;
  logger: RuntimeLogger;
  dispose(): void;
}

export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const homePaths = initializeMegumiHomeSync(options.home);
  const logger = options.runtimeLoggerFactory(homePaths);
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
      branchService: createUnsupportedSessionBranchHost(),
      sessionTimelineQuery: runtime.sessionTimelineQuery,
      agentRunQueries: runtime.agentRunQueries,
      contextUsageMonitor: runtime.contextRuntime.contextUsageMonitor,
      contextUsageWindowProvider: runtime.contextUsageWindowProvider,
    }),
    skill: createSkillHost(runtime.skillService),
    workspace: createWorkspaceHost({
      workspaceService: runtime.workspaceService,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
    }),
    settings: createSettingsHost(runtime.settingsService),
    approval: createApprovalHost(runtime.agentRunService),
    artifacts: {
      ...artifacts,
      plan: createPlanHost(runtime.planArtifactService),
    },
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
    runtimeLoggerFactory: _runtimeLoggerFactory,
    directoryPicker: _directoryPicker,
    ...codingAgent
  } = options;
  return codingAgent;
}

function createUnsupportedSessionBranchHost(): SessionBranchHostPort {
  return {
    createBranchDraft() {
      throw new Error('Session branch drafts are not available during the Agent Run transition.');
    },
    cancelBranchDraft() {
      return { cancelled: false, reason: 'branch_marker_not_found', events: [] };
    },
  };
}
