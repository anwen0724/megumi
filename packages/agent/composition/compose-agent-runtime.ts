/*
 * Composes the Agent runtime exposed to Product Composition.
 * Host-facing adaptation is owned by packages/product.
 */
import { readFile, readdir } from 'node:fs/promises';
import { createCommandService, type CommandService, type SkillCommandDescriptor } from '../commands';
import { createInputService, type InputFileReader, type InputService } from '../input';
import {
  createSessionBranchService,
  createSessionService,
  type SessionBranchService,
  type SessionService,
} from '../session';
import {
  createSessionAttachmentFileStore,
  type SessionAttachmentFileSystem,
} from '../session/repository/session-attachment-file-store';
import { SessionRepository as SessionV2Repository } from '../session/repository/session-repository';
import type { RuntimeLogger } from './runtime-logger';
import { composeAgentPersistence } from './compose-agent-persistence';
import {
  composeAgentToolExecutionService,
  composeAgentToolRegistryService,
  type LocalWorkspaceFileSystem,
} from './compose-agent-tool-runtime';
import { composeAgentContext, type ContextCapacity } from '../context';
import { composeAgentInstructions } from '../instructions';
import { composeSkills, type Skill, type SkillService } from '@megumi/skills';
import {
  createSettingsService,
  type SettingsFileStore,
  type SettingsService,
} from '../settings';
import {
  createWorkspaceChangeService,
  createWorkspaceFilesService,
  createWorkspacePathPolicyService,
  createWorkspaceService,
  type WorkspaceChangeService,
  type WorkspaceFilesService,
  type WorkspacePathPolicyService,
  type WorkspaceService,
} from '../workspace';
import { createPermissionService, type PermissionService } from '../permissions';
import { createLocalSettingsJsonStorage } from '../adapters/local/settings/settings-json-storage';
import {
  createLocalProjectFileSystem,
  type LocalWorkspaceServiceFileSystem,
} from '../adapters/local/workspace/project-file-system';
import { createLocalWorkspaceFilesFileSystem } from '../adapters/local/workspace/workspace-files-file-system';
import type { ObservabilityService } from '@megumi/observability';
import {
  createSessionTimelineQuery,
  type SessionTimelineQuery,
} from '../projections/timeline';
import {
  createWorkspaceChangeFooterProjectorService,
  type WorkspaceChangeFooterProjectorService,
} from '../projections/workspace/workspace-change-footer-projector';
import { WorkspaceChangeRepository } from '../workspace/repositories/workspace-change-repository';
import { WorkspaceRepository } from '../workspace/repositories/workspace-repository';
import { createWebSearchService } from '../tools/built-in-tools';
import type { ToolExecutionService, ToolRegistryService } from '../tools';
import type { Models } from '@megumi/ai';

export interface AgentHomePaths {
  homePath: string;
  sqlitePath: string;
  settingsPath: string;
  attachmentsPath: string;
}

export interface ComposeAgentRuntimeOptions {
  homePaths: AgentHomePaths;
  migrationsFolder?: string;
  migrationEnvironment?: Parameters<typeof composeAgentPersistence>[0]['migrationEnvironment'];
  runtimeLogger: RuntimeLogger;
  observabilityService?: ObservabilityService;
  models?: Pick<Models, 'completeSimple'>;
  isRunLive?: (runId: string) => boolean;
  modelContextProvider?: ModelContextProvider;
  appSettingsProvider?: unknown;
  workspaceChangeFooterProjector?: unknown;
  projectFileSystem?: LocalWorkspaceServiceFileSystem;
  settingsStorage?: SettingsFileStore;
  inputFileReader?: InputFileReader;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
  isBuiltInToolAvailable?: (toolName: string) => boolean;
  toolFileSystem?: LocalWorkspaceFileSystem;
}

export interface AgentRuntime {
  inputService: InputService;
  commandService: CommandService;
  skillService: SkillService;
  createSkillService(input?: { workspaceId?: string }): SkillService;
  sessionService: SessionService;
  sessionBranchService: SessionBranchService;
  settingsService: SettingsService;
  workspaceService: WorkspaceService;
  workspaceFilesService: WorkspaceFilesService;
  workspaceChangeService: WorkspaceChangeService;
  workspacePathPolicyService: WorkspacePathPolicyService;
  permissionService: PermissionService;
  toolRegistryService: ToolRegistryService;
  toolExecutionForRun(input: AgentToolExecutionScope): Pick<ToolExecutionService, 'executeTool'>;
  contextRuntime: ReturnType<typeof composeAgentContext>;
  sessionTimelineQuery: SessionTimelineQuery;
  modelContextProvider: ModelContextProvider;
  dispose(): void;
}

export interface AgentToolExecutionScope {
  runId: string;
  sessionId: string;
  workspaceId: string;
}

export type ModelContextProvider = (selection: {
  providerId: string;
  modelId: string;
}) => ContextCapacity;

export function createSettingsModelContextProvider(
  settingsService: Pick<SettingsService, 'resolveModelContextSettings'>,
): ModelContextProvider {
  return ({ providerId, modelId }) => {
    const result = settingsService.resolveModelContextSettings({
      provider_id: providerId,
      model_id: modelId,
    });
    if (result.status === 'failed') {
      throw new Error(result.failure.message);
    }
    return {
      providerId,
      modelId,
      contextWindowTokens: result.context.context_window_tokens,
    };
  };
}

export function composeAgentRuntime(options: ComposeAgentRuntimeOptions): AgentRuntime {
  const persistence = composeAgentPersistence({
    sqlitePath: options.homePaths.sqlitePath,
    migrationsFolder: options.migrationsFolder,
    migrationEnvironment: options.migrationEnvironment,
  });
  const workspaceRepository = new WorkspaceRepository(persistence.database);
  const workspaceChangeRepository = new WorkspaceChangeRepository(persistence.database);
  const sessionRepository = new SessionV2Repository(persistence.database);
  const sessionService = observeSessionService(createSessionService({
    repository: sessionRepository,
    ...(options.sessionAttachmentFileSystem ? {
      attachmentFileStore: createSessionAttachmentFileStore({
        attachmentsPath: options.homePaths.attachmentsPath,
        fileSystem: options.sessionAttachmentFileSystem,
      }),
    } : {}),
  }), options.observabilityService);
  const sessionBranchService = createSessionBranchService({
    entries: {
      findMessageEntry: (input) => sessionRepository.findMessageEntry(input),
    },
  });
  const inputService = createInputService({
    fileReader: options.inputFileReader ?? {
      readFile: async () => { throw new Error('Host image file reading is unavailable.'); },
      resolveLocalFile: async () => { throw new Error('Host document file resolution is unavailable.'); },
    },
  });
  const settingsService = resolveSettingsService(options.appSettingsProvider) ?? createSettingsService({
    file_store: options.settingsStorage ?? createLocalSettingsJsonStorage({
      settingsPath: options.homePaths.settingsPath,
    }),
    env: process.env,
  });
  const resolveWebSearchConfig = () => {
    const result = settingsService.resolveWebSearchRuntimeConfig();
    return result.status === 'configured'
      ? {
          provider: result.config.provider,
          apiKey: result.config.api_key,
          ...(result.config.base_url ? { baseUrl: result.config.base_url } : {}),
        }
      : undefined;
  };
  const toolRegistry = composeAgentToolRegistryService({
    isWebSearchEnabled: () => Boolean(resolveWebSearchConfig()),
    ...(options.isBuiltInToolAvailable ? { isBuiltInToolAvailable: options.isBuiltInToolAvailable } : {}),
  });
  const workspaceFileSystem = options.projectFileSystem ?? createLocalProjectFileSystem();
  const workspacePathPolicyService = createWorkspacePathPolicyService();
  const workspaceService = createWorkspaceService({
    repository: workspaceRepository,
    file_system: workspaceFileSystem,
  });
  const skillComposition = composeSkills({
    database: persistence.database,
    homePath: options.homePaths.homePath,
  });
  const createSkillServiceForWorkspace = (input: { workspaceId?: string } = {}) => {
    if (!input.workspaceId) return skillComposition.createSkillService();
    const workspace = workspaceService.getWorkspace({ workspace_id: input.workspaceId });
    return workspace.status === 'found'
      ? skillComposition.createSkillService({ workspaceRoot: workspace.workspace.root_path })
      : skillComposition.createSkillService();
  };
  const defaultSkillService = createSkillServiceForWorkspace();
  const commandService = createCommandService({
    skillCommandProvider: {
      async listSkillCommands(request) {
        const skills = await createSkillServiceForWorkspace(request).listSkills({});
        if (skills.status === 'failed') {
          return [];
        }
        return skills.skills
          .filter((skill) => skill.available)
          .map(toSkillCommandDescriptor);
      },
    },
  });
  const workspaceChangeService = createWorkspaceChangeService({
    repository: workspaceChangeRepository,
    path_policy: workspacePathPolicyService,
    file_system: workspaceFileSystem,
  });
  const workspaceChangeFooterProjector = resolveWorkspaceChangeFooterProjector(
    options.workspaceChangeFooterProjector,
    workspaceChangeService,
  );
  const sessionTimelineQuery = createSessionTimelineQuery({
    sessionService,
    isRunLive: options.isRunLive ?? (() => false),
    workspaceChangeFooterProjector,
  });
  const workspaceFilesService = createWorkspaceFilesService({
    workspaceService,
    pathPolicy: workspacePathPolicyService,
    fileSystem: createLocalWorkspaceFilesFileSystem(),
  });
  const permissionService = createPermissionService({
    settings_service: {
      resolvePermissionSettings(request) {
        const result = settingsService.resolvePermissionSettings(request);
        return result.status === 'ok'
          ? result
          : {
              status: 'failed' as const,
              failure: {
                code: result.failure.code,
                message: result.failure.message,
              },
            };
      },
      async addPermissionRules(request) {
        const result = settingsService.addPermissionRules({
          rules: request.rules,
          session_id: request.session_id,
          applied_at: request.applied_at,
        });
        return result.status === 'saved'
          ? { status: 'saved' as const }
          : { status: 'failed' as const, failure: result.failure };
      },
    },
    workspace_path_policy: {
      classifyPath(request) {
        const workspace = workspaceService.getWorkspace({
          workspace_id: request.workspace_id,
        });
        if (workspace.status !== 'found') {
          return {
            status: 'failed' as const,
            failure: {
              code: 'workspace_not_found',
              message: 'Workspace was not found.',
            },
          };
        }
        return {
          status: 'classified' as const,
          workspace_path: workspacePathPolicyService.classifyPath({
            workspace_root: workspace.workspace.root_path,
            target_path: request.target_path,
          }),
        };
      },
    },
  });
  const instructionService = composeAgentInstructions({
    megumiHomePath: options.homePaths.homePath,
    fileSystem: {
      readFile: (filePath) => readFile(filePath, 'utf8'),
      readDirectory: (directoryPath) => readdir(directoryPath),
    },
  });
  const modelContextProvider = options.modelContextProvider ?? createSettingsModelContextProvider(settingsService);
  const contextModels: Pick<Models, 'completeSimple'> = options.models ?? {
    async completeSimple() {
      throw new Error('Agent Context requires Product-owned Models.');
    },
  };
  const contextRuntime = composeAgentContext({
    sessionService,
    instructionScopeResolver: {
      resolve({ workspaceId }) {
        const workspace = workspaceService.getWorkspace({ workspace_id: workspaceId });
        return workspace.status === 'found'
          ? { status: 'resolved', workspaceRoot: workspace.workspace.root_path, workingDirectory: workspace.workspace.root_path }
          : { status: 'failed', failure: { code: 'workspace_not_found', message: `Workspace ${workspaceId} was not found.` } };
      },
    },
    instructionService,
    skillServiceFactory: ({ workspaceRoot }) =>
      skillComposition.createSkillService({ workspaceRoot }),
    models: contextModels,
    policyProvider: {
      getPolicy() {
        const resolved = settingsService.getResolvedSettings();
        return resolved.status === 'ok'
          ? { compactionThresholdRatio: resolved.settings.context.compaction_threshold_ratio }
          : {};
      },
    },
    ...(options.observabilityService ? { observability: options.observabilityService } : {}),
  });
  const toolExecutionForRun = (scope: AgentToolExecutionScope) => {
    const workspace = workspaceService.getWorkspace({ workspace_id: scope.workspaceId });
    if (workspace.status !== 'found') {
      throw new Error(`Workspace ${scope.workspaceId} is unavailable for Tool execution.`);
    }
    const workspaceRoot = workspace.workspace.root_path;
    const webSearchConfig = resolveWebSearchConfig();
    const runToolRegistry = composeAgentToolRegistryService({
      webSearchEnabled: Boolean(webSearchConfig),
      ...(options.isBuiltInToolAvailable ? { isBuiltInToolAvailable: options.isBuiltInToolAvailable } : {}),
    });
    const toolExecutionService = composeAgentToolExecutionService({
      projectRoot: workspaceRoot,
      registryService: runToolRegistry,
      workspacePathPolicyService,
      ...(options.toolFileSystem ? { fileSystem: options.toolFileSystem } : {}),
      skillService: createSkillServiceForWorkspace({ workspaceId: scope.workspaceId }),
      ...(webSearchConfig ? { webSearchService: createWebSearchService(webSearchConfig) } : {}),
    });
    return {
      executeTool(request: Parameters<ToolExecutionService['executeTool']>[0]) {
        return workspaceChangeService.trackToolExecution({
          scope: {
            run_id: scope.runId,
            session_id: scope.sessionId,
            workspace_id: scope.workspaceId,
          },
          tool_execution: {
            tool_name: request.toolName,
            input: request.input,
            workspace_root: workspaceRoot,
          },
          execute: () => Promise.resolve(toolExecutionService.executeTool(request)),
        });
      },
    };
  };
  return {
    inputService,
    commandService,
    skillService: defaultSkillService,
    createSkillService: createSkillServiceForWorkspace,
    sessionService,
    sessionBranchService,
    settingsService,
    workspaceService,
    workspaceFilesService,
    workspaceChangeService,
    workspacePathPolicyService,
    permissionService,
    toolRegistryService: toolRegistry,
    toolExecutionForRun,
    contextRuntime,
    sessionTimelineQuery,
    modelContextProvider,
    dispose: () => persistence.database.close(),
  };
}

function observeSessionService(service: SessionService, observability?: ObservabilityService): SessionService {
  if (!observability) return service;
  const observe = <T extends { status: string }>(role: string, operation: () => T): T => {
    const span = observability.startSpan({ name: 'session.append_message', attributes: { role } });
    return observability.runInSpanContext(span, () => {
      const result = operation();
      observability.endSpan({ span, status: result.status === 'saved' ? 'ok' : 'error', attributes: { role } });
      return result;
    });
  };
  const observeAsync = async <T extends { status: string }>(role: string, operation: () => Promise<T>): Promise<T> => {
    const span = observability.startSpan({ name: 'session.append_message', attributes: { role } });
    return observability.runInSpanContext(span, async () => {
      const result = await operation();
      observability.endSpan({ span, status: result.status === 'saved' ? 'ok' : 'error', attributes: { role } });
      return result;
    });
  };
  return new Proxy(service, {
    get(target, property, receiver) {
      if (property === 'saveUserMessage') return (request: Parameters<SessionService['saveUserMessage']>[0]) => observeAsync('user', () => target.saveUserMessage(request));
      if (property === 'saveModelResponse') return (request: Parameters<SessionService['saveModelResponse']>[0]) => observe('model_response', () => target.saveModelResponse(request));
      if (property === 'saveAssistantReply') return (request: Parameters<SessionService['saveAssistantReply']>[0]) => observe('assistant_reply', () => target.saveAssistantReply(request));
      if (property === 'saveToolResultMessage') return (request: Parameters<SessionService['saveToolResultMessage']>[0]) => observe('toolResult', () => target.saveToolResultMessage(request));
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function toSkillCommandDescriptor(skill: Skill): SkillCommandDescriptor {
  return {
    name: skill.name,
    skillPath: skill.skillPath,
    description: skill.description,
    sourceLabel: skill.source.owner === 'system' ? 'System' : 'User',
  };
}

function resolveWorkspaceChangeFooterProjector(
  projector: unknown,
  workspaceChangeService: WorkspaceChangeService,
): WorkspaceChangeFooterProjectorService {
  if (isWorkspaceChangeFooterProjectorService(projector)) {
    return projector;
  }

  return createWorkspaceChangeFooterProjectorService({
    workspaceChanges: workspaceChangeService,
  });
}

function isWorkspaceChangeFooterProjectorService(value: unknown): value is WorkspaceChangeFooterProjectorService {
  return typeof value === 'object'
    && value !== null
    && 'projectRunFooter' in value
    && typeof value.projectRunFooter === 'function';
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
    && 'getResolvedSettings' in value
    && 'getWebSearchSettings' in value
    && 'resolveWebSearchRuntimeConfig' in value,
  );
}
