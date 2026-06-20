// Defines the desktop composition root surface without constructing runtime dependencies.
import type { AgentRuntimePort } from '../../app';
import type { AiRequestOptions, Model } from '../../ai';
import type { AgentAiClient } from '../../agent';
import type {
  SqliteDatabase,
  SqliteProjectRepository,
  SqliteRecoveryRepository,
  SqliteRuntimeEventRepository,
  SqliteSessionStateRepository,
  SqliteTimelineMessageRepository,
  SqliteToolExecutionRepository,
  SqliteWorkspaceRepository,
} from '../../database';
import type { evaluatePermissionPolicy, PermissionRepository } from '../../permission';
import type { createSessionStateManager } from '../../session';
import type { createBuiltInToolRegistry, createToolExecutionService } from '../../tools';
import type { WorkspaceManager } from '../../workspace';
import type { AppSettingsStore } from '../infrastructure/app-settings-store';
import type { MegumiHomePaths } from '../infrastructure/megumi-home';
import type { ProviderSettingsStore } from '../infrastructure/provider-settings-store';
import type { RuntimeLogger } from '../infrastructure/runtime-logger';
import type { RuntimeEventBus } from './create-runtime-event-bus';
import type { DesktopHostAdapters } from './create-host-adapters';

export interface LocalDesktopRuntime {
  agentRuntime: AgentRuntimePort;
  eventBus: RuntimeEventBus;
  hosts: DesktopHostAdapters;
  database: SqliteDatabase;
  megumiHomePaths: MegumiHomePaths;
  settingsStore: AppSettingsStore;
  providerSettingsStore: ProviderSettingsStore;
  projectRepository: SqliteProjectRepository;
  runtimeEventRepository: SqliteRuntimeEventRepository;
  timelineMessageRepository: SqliteTimelineMessageRepository;
  recoveryRepository: SqliteRecoveryRepository;
  runtimeLogger: RuntimeLogger;
  sessionRepository: SqliteSessionStateRepository;
  sessionManager: ReturnType<typeof createSessionStateManager>;
  permissionRepository: PermissionRepository;
  permissionEvaluator: { evaluate: typeof evaluatePermissionPolicy };
  toolRegistry: ReturnType<typeof createBuiltInToolRegistry>;
  toolExecutionService: ReturnType<typeof createToolExecutionService>;
  toolExecutionRepository: SqliteToolExecutionRepository;
  workspaceRepository: SqliteWorkspaceRepository;
  workspaceManager: WorkspaceManager;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface CreateLocalDesktopRuntimeOptions {
  hosts?: DesktopHostAdapters;
  eventBus?: RuntimeEventBus;
  databasePath?: string;
  workspaceRoot?: string;
  now?: () => string;
  createId?: (prefix: string, value: string) => string;
  ai?: AgentAiClient;
  model?: Model;
  aiOptions?: AiRequestOptions;
  systemInstruction?: string;
}
