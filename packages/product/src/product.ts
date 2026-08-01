/*
 * Composes the complete Product directly from real Package contracts and owns
 * Product resource startup, per-Run Tool snapshots, and ordered shutdown.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Api, Model, Models, ProviderStreams } from '@megumi/ai';
import {
  createCommands,
  createInputCommandHandler,
  type Commands,
  type SkillSuggestionDescriptor,
} from '@megumi/commands';
import { createContext } from '@megumi/context';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
  type ResolveDatabaseMigrationsFolderRequest,
} from '@megumi/database';
import { createEngine, type Engine, type EnginePolicy } from '@megumi/engine';
import type { RuntimeEvent } from '@megumi/events';
import { createInputProcessor, type InputSourceAccess } from '@megumi/input';
import { createInstructionReader } from '@megumi/instructions';
import {
  composeObservability,
  createObservabilityRuntimeLogger,
  type ObservabilityStorage,
  type RuntimeLogger,
} from '@megumi/observability';
import { createPermissions } from '@megumi/permissions';
import { createNodeSandboxFileAccess } from '@megumi/sandbox';
import {
  createSessionTimelineQuery,
  createWorkspaceChangeFooterProjector,
} from '@megumi/projections';
import {
  createSessionAttachmentReader,
  createSessionBranchDrafts,
  createSessionCatalog,
  createSessionHistory,
  type SessionAttachmentFileSystem,
} from '@megumi/session';
import { createSessionAttachmentFileStore } from '@megumi/session/attachment-store';
import { createSessionStore } from '@megumi/session/store';
import { createSettings, type Settings, type SettingsStore } from '@megumi/settings';
import { createSettingsStore } from '@megumi/settings/store';
import { composeSkills, type SkillService } from '@megumi/skills';
import {
  BUILT_IN_TOOL_NAMES,
  createTools,
  createWebFetch,
  createWebSearch,
  type BuiltInToolName,
  type ToolCatalog,
  type ToolExecutor,
  ToolExecutionFailure,
  type ToolProcessAdapter,
  type WorkspaceFileAccess,
} from '@megumi/tools';
import {
  createWorkspaceCatalog,
  createWorkspaceChanges,
  createWorkspaceFiles,
  createWorkspacePathPolicy,
  type WorkspaceCatalog,
  type WorkspacePathPolicy,
} from '@megumi/workspace';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';
import { createWorkspaceStore } from '@megumi/workspace/store';
import {
  initializeMegumiHomeSync,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomePaths,
} from './home/home';
import { createProductChat } from './chat';
import { createProductApproval } from './approval';
import { createInputSubmission } from './input-submission';
import { composeModels } from './models';
import { ProductRunReadModel } from './run-read-model';
import { createApprovalHost } from './host/approval-host';
import { createUnavailableArtifactHost } from './host/artifact-host';
import { createChatHost } from './host/chat-host';
import type {
  InputAttachmentPickerPort,
  LocalFileAvailabilityPort,
} from './host/chat-contract';
import { createObservabilityHost, type DiagnosticBundleSavePort } from './host/observability-host';
import type { ProductHostInterface } from './host/product-host';
import { createSettingsHost } from './host/settings-host';
import { createSkillHost } from './host/skills-host';
import { createWorkspaceHost } from './host/workspace-host';
import type {
  DirectoryPickerPort,
  FileOpenPort,
} from './host/workspace-contract';
import { migrateLegacyPermissionSettingsFile } from './migrations/legacy-permission-settings';
import { migrateLegacyProviderApiSettingsFile } from './migrations/legacy-provider-api-settings';

export interface ComposeProductOptions {
  home: InitializeMegumiHomeSyncOptions;
  migrationsFolder?: string;
  migrationEnvironment?: Omit<ResolveDatabaseMigrationsFolderRequest, 'migrationsFolder'>;
  observabilityStorage?: ObservabilityStorage;
  productEnvironment?: { appVersion: string; platform: string; arch: string };
  diagnosticBundleSave?: DiagnosticBundleSavePort;
  directoryPicker?: DirectoryPickerPort;
  fileOpen?: FileOpenPort;
  attachmentPicker?: InputAttachmentPickerPort;
  localFileAvailability?: LocalFileAvailabilityPort;
  inputSourceAccess?: InputSourceAccess;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
  settingsStorage?: SettingsStore;
  toolProcess?: ToolProcessAdapter;
  isBuiltInToolAvailable?: (toolName: string) => boolean;
  modelStreams?: Partial<Record<Api, ProviderStreams>>;
}

export type ProductInputSourceAccess = NonNullable<ComposeProductOptions['inputSourceAccess']>;
export type ProductSessionAttachmentFileSystem = NonNullable<ComposeProductOptions['sessionAttachmentFileSystem']>;
export type ProductBuiltInToolAvailability = NonNullable<ComposeProductOptions['isBuiltInToolAvailable']>;
export type ProductObservabilityStorage = NonNullable<ComposeProductOptions['observabilityStorage']>;

export interface ProductRuntime {
  homePaths: MegumiHomePaths;
  host: ProductHostInterface;
  logger: RuntimeLogger;
  observability: ReturnType<typeof composeObservability>;
  models: Models;
  resolveModel(request: { provider_id: string; model_id: string }): Promise<ResolveModelResult>;
  dispose(): Promise<void>;
}

export type ResolveModelResult =
  | { status: 'ok'; model: Model<Api> }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };

export function composeProduct(options: ComposeProductOptions): ProductRuntime {
  const homePaths = initializeMegumiHomeSync(options.home);
  migrateLegacyPermissionSettingsFile(homePaths.settingsPath);
  migrateLegacyProviderApiSettingsFile(homePaths.settingsPath);
  const observability = composeObservability({
    directoryPath: `${homePaths.logsPath}/observability`,
    storage: options.observabilityStorage ?? noopObservabilityStorage,
    appVersion: options.productEnvironment?.appVersion ?? 'unknown',
    platform: options.productEnvironment?.platform ?? 'unknown',
    arch: options.productEnvironment?.arch ?? 'unknown',
  });
  const logger = createObservabilityRuntimeLogger(observability.service);
  const modelComposition = composeModels({
    ...(options.modelStreams ? { apiImplementations: options.modelStreams } : {}),
  });
  const runReadModel = new ProductRunReadModel({
    terminalRetentionMs: PRODUCT_ENGINE_POLICY.terminalRunRetentionMs,
  });
  const database = openDatabase(homePaths, options);

  const settings = createSettings({
    store: options.settingsStorage ?? createSettingsStore({ settingsPath: homePaths.settingsPath }),
    env: process.env,
  });
  const workspaceStore = createWorkspaceStore({ database });
  const workspaceFileSystem = createNodeWorkspaceFileSystem();
  const workspacePathPolicy = createWorkspacePathPolicy();
  const workspaces = createWorkspaceCatalog({ store: workspaceStore, file_system: workspaceFileSystem });
  const workspaceFiles = createWorkspaceFiles({
    catalog: workspaces,
    path_policy: workspacePathPolicy,
    file_system: workspaceFileSystem,
  });
  const workspaceChanges = createWorkspaceChanges({
    store: workspaceStore,
    path_policy: workspacePathPolicy,
    file_system: workspaceFileSystem,
  });

  const sessionStore = createSessionStore({ database });
  const attachmentContentStore = options.sessionAttachmentFileSystem
    ? createSessionAttachmentFileStore({
        attachmentsPath: homePaths.attachmentsPath,
        fileSystem: options.sessionAttachmentFileSystem,
      })
    : undefined;
  const sessions = createSessionCatalog({ store: sessionStore });
  const history = createSessionHistory({
    store: sessionStore,
    ...(attachmentContentStore ? { attachmentContentStore } : {}),
  });
  const attachments = createSessionAttachmentReader({
    store: sessionStore,
    ...(attachmentContentStore ? { contentStore: attachmentContentStore } : {}),
  });
  const branches = createSessionBranchDrafts({
    entries: { findMessageEntry: (request) => sessionStore.findMessageEntry(request) },
  });

  const skillComposition = composeSkills({ database, homePath: homePaths.homePath });
  const resolveSkillService = (request: { workspaceId?: string } = {}): SkillService => {
    if (!request.workspaceId) return skillComposition.createSkillService();
    const workspace = workspaces.getWorkspace({ workspace_id: request.workspaceId });
    return workspace.status === 'found'
      ? skillComposition.createSkillService({ workspaceRoot: workspace.workspace.root_path })
      : skillComposition.createSkillService();
  };
  const instructions = createInstructionReader({ megumiHomePath: homePaths.homePath });
  const toolProcess = options.toolProcess ?? createNodeToolProcessAdapter();
  const context = createContext({
    sessionHistory: history,
    attachmentReader: attachments,
    scopeResolver: {
      resolve({ workspaceId }) {
        const workspace = workspaces.getWorkspace({ workspace_id: workspaceId });
        return workspace.status === 'found'
          ? {
              status: 'resolved',
              workspaceRoot: workspace.workspace.root_path,
              executionEnvironment: {
                workingDirectory: workspace.workspace.root_path,
                operatingSystem: modelVisibleOperatingSystem(process.platform),
                shell: toolProcess.shellName,
              },
            }
          : {
              status: 'failed',
              failure: { code: 'workspace_not_found', message: `Workspace ${workspaceId} was not found.` },
            };
      },
    },
    instructionReader: instructions,
    skillServiceFactory: ({ workspaceRoot }) => skillComposition.createSkillService({ workspaceRoot }),
    models: modelComposition.models,
    policyProvider: {
      getPolicy() {
        return { compactionThresholdRatio: settings.resolve().context.compaction_threshold_ratio };
      },
    },
    observability: observability.service,
  });
  const permissions = createPermissions({
    ruleReader: {
      resolvePermissionRules(request) {
        return {
          status: 'resolved',
          permissionSettings: settings.resolvePermissions({
            workspace_id: request.workspaceId,
            session_id: request.sessionId,
          }),
        };
      },
    },
    ruleWriter: {
      addPermissionRules(request) {
        const result = settings.addPermissionRules({
          session_id: request.sessionId,
          rules: [...request.rules],
          applied_at: request.appliedAt,
        });
        return result.status === 'saved'
          ? { status: 'saved' }
          : { status: 'failed', failure: result.failure };
      },
    },
    workspacePathClassifier: {
      classifyWorkspacePath(request) {
        const workspace = workspaces.getWorkspace({ workspace_id: request.workspaceId });
        if (workspace.status !== 'found') {
          return { status: 'failed', failure: { code: 'workspace_not_found', message: 'Workspace was not found.' } };
        }
        const classified = workspacePathPolicy.classifyPath({
          workspace_root: workspace.workspace.root_path,
          target_path: request.targetPath,
        });
        return {
          status: 'classified',
          workspacePath: {
            absolutePath: classified.absolute_path,
            workspacePath: classified.workspace_path,
            insideWorkspace: classified.inside_workspace,
            protected: classified.protected,
            sensitive: classified.sensitive,
          },
        };
      },
    },
  });

  const commands: Commands = createCommands({
    compact: (request, operationOptions) => context.compact({
      ...request,
      ...(operationOptions?.signal ? { signal: operationOptions.signal } : {}),
    }),
    skillSuggestionProvider: {
      async listSkillSuggestions(request) {
        const result = await resolveSkillService(request).listSkills({});
        if (result.status === 'failed') return [];
        return result.skills.filter((skill) => skill.available).map((skill): SkillSuggestionDescriptor => ({
          name: skill.name,
          skillPath: skill.skillPath,
          description: skill.description,
          sourceLabel: skill.source.owner === 'system' ? 'System' : 'User',
        }));
      },
    },
  });
  const input = createInputProcessor({
    sourceAccess: options.inputSourceAccess ?? unavailableInputSourceAccess,
    commandHandler: createInputCommandHandler(commands),
  });
  const resolveModel: ProductRuntime['resolveModel'] = async (request) => {
    const resolved = settings.resolveProvider(request);
    if (resolved.status === 'failed') return { status: 'failed', failure: resolved.failure };
    const credential = settings.readProviderApiKey({ provider_id: request.provider_id });
    if (credential.status === 'failed') return { status: 'failed', failure: credential.failure };
    try {
      return {
        status: 'ok',
        model: await modelComposition.resolveModel({
          ...resolved.config,
          ...(credential.status === 'found' ? { api_key: credential.api_key } : {}),
        }),
      };
    } catch {
      return {
        status: 'failed',
        failure: { code: 'model_resolution_failed', message: 'The selected model could not be prepared.' },
      };
    }
  };

  const tools = createProductToolSnapshots({
    settings,
    workspaces,
    workspaceChanges,
    resolveSkillService,
    process: toolProcess,
    isBuiltInToolAvailable: options.isBuiltInToolAvailable,
  });
  const workspaceChangeFooter = createWorkspaceChangeFooterProjector({ workspaceChanges });
  const timeline = createSessionTimelineQuery({
    sessionHistory: history,
    isRunLive: (runId) => runReadModel.listLiveRunIds().includes(runId),
    workspaceChangeFooterProjector: workspaceChangeFooter,
  });
  const rawEngine = createEngine({
    models: modelComposition.models,
    context,
    session: history,
    toolCatalog: tools.catalog,
    toolExecutionForRun: tools.executionForRun,
    permissions,
    eventPublisher: {
      publish(event) {
        runReadModel.recordEvent(event);
        finalizeWorkspaceChangesForTerminalEvent(event, runReadModel, workspaceChanges);
      },
    },
    observability: observability.service,
    ids: {
      createRunId: () => `run:${crypto.randomUUID()}`,
      createModelCallId: () => `model-call:${crypto.randomUUID()}`,
      createToolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
      createRunApprovalId: () => `run-approval:${crypto.randomUUID()}`,
      createSessionMessageId: () => `message:${crypto.randomUUID()}`,
      createRuntimeEventId: () => `event:${crypto.randomUUID()}`,
    },
    clock: { now: () => new Date().toISOString() },
    policy: PRODUCT_ENGINE_POLICY,
  });
  const engineController = trackProductRuns(rawEngine, runReadModel);
  const engine = engineController.engine;
  const submission = createInputSubmission({
    engine,
    input,
    sessions,
    branches,
    resolveModel,
  });
  const chat = createProductChat({
    submission,
    engine,
    commands,
    sessions,
    history,
    attachments,
    branches,
    workspaces,
    runs: runReadModel,
    timeline,
    context,
    ...(options.attachmentPicker ? { attachmentPicker: options.attachmentPicker } : {}),
    ...(options.localFileAvailability ? { localFileAvailability: options.localFileAvailability } : {}),
  });
  const approval = createProductApproval(engine);
  const host: ProductHostInterface = {
    chat: createChatHost(chat),
    skill: createSkillHost({ resolveSkillService }),
    workspace: createWorkspaceHost({
      workspaceService: workspaces,
      workspaceFilesService: workspaceFiles,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
      ...(options.fileOpen ? { fileOpen: options.fileOpen } : {}),
    }),
    settings: createSettingsHost(settings, {
      listAvailableTools: () => [...tools.catalog.list().tools],
    }),
    approval: createApprovalHost(approval),
    artifacts: createUnavailableArtifactHost(),
    observability: createObservabilityHost(observability.queryService, options.diagnosticBundleSave),
  };

  let disposePromise: Promise<void> | undefined;
  return {
    homePaths,
    host,
    logger,
    observability,
    models: modelComposition.models,
    resolveModel,
    dispose: () => {
      disposePromise ??= disposeProduct({ engineController, runReadModel, observability, database });
      return disposePromise;
    },
  };
}

const PRODUCT_ENGINE_POLICY = {
  maxModelCallsPerRun: 80,
  maxToolRoundsPerRun: 50,
  maxToolCallsPerModelCall: 32,
  maxToolCallsPerRun: 256,
  maxConcurrentToolExecutions: 4,
  modelCallTimeoutMs: 120_000,
  toolExecutionTimeoutMs: 120_000,
  cancellationTimeoutMs: 10_000,
  maxModelCallAttempts: 3,
  modelRetryDelayMs: 1_000,
  maxToolExecutionsPerCall: 1,
  toolRetryDelayMs: 500,
  terminalRunRetentionMs: 300_000,
} satisfies EnginePolicy;

function openDatabase(homePaths: MegumiHomePaths, options: ComposeProductOptions): DatabaseConnection {
  const database = createDatabase({ filename: path.join(homePaths.sqlitePath, 'megumi.sqlite') });
  try {
    migrateDatabase({
      database,
      ...(options.migrationsFolder ? { migrationsFolder: options.migrationsFolder } : {}),
      ...(options.migrationEnvironment ? { migrationEnvironment: options.migrationEnvironment } : {}),
    });
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function createProductToolSnapshots(input: {
  settings: Settings;
  workspaces: WorkspaceCatalog;
  workspaceChanges: ReturnType<typeof createWorkspaceChanges>;
  resolveSkillService(request?: { workspaceId?: string }): SkillService;
  process: ToolProcessAdapter;
  isBuiltInToolAvailable?: (toolName: string) => boolean;
}): {
  catalog: Pick<ToolCatalog, 'list'>;
  executionForRun(scope: { runId: string; sessionId: string; workspaceId: string }): Pick<ToolExecutor, 'preflight' | 'execute'>;
} {
  type Snapshot = ReturnType<typeof resolveToolSnapshot>;
  let pending: Snapshot | undefined;
  const catalog: Pick<ToolCatalog, 'list'> = {
    list(request) {
      pending = resolveToolSnapshot(input.settings, input.isBuiltInToolAvailable);
      return createToolsForSnapshot(
        pending,
        unavailableWorkspaceFileAccess,
        input.process,
        input.resolveSkillService(),
      ).catalog.list(request);
    },
  };
  return {
    catalog,
    executionForRun(scope) {
      const snapshot = pending ?? resolveToolSnapshot(input.settings, input.isBuiltInToolAvailable);
      pending = undefined;
      const workspace = input.workspaces.getWorkspace({ workspace_id: scope.workspaceId });
      if (workspace.status !== 'found') throw new Error(`Workspace ${scope.workspaceId} is unavailable for Tool execution.`);
      const workspaceRoot = workspace.workspace.root_path;
      const tools = createToolsForSnapshot(
        snapshot,
        createNodeSandboxFileAccess({ workspaceRoot }),
        input.process,
        input.resolveSkillService({ workspaceId: scope.workspaceId }),
      );
      return {
        preflight: (request) => tools.executor.preflight(request),
        execute(request, operationOptions) {
          return input.workspaceChanges.trackToolExecution({
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
            execute: () => tools.executor.execute(request, operationOptions),
            is_successful_outcome: (result) => result.type === 'succeeded',
          });
        },
      };
    },
  };
}

function resolveToolSnapshot(
  settings: Settings,
  isAvailable?: (toolName: string) => boolean,
) {
  const webSettings = settings.resolveWebSearch();
  const credential = settings.readWebSearchApiKey({});
  const webSearch = webSettings.status === 'ok'
    && webSettings.settings.provider
    && credential.status === 'found'
    ? createWebSearch({
        provider: webSettings.settings.provider,
        apiKey: credential.api_key,
        ...(webSettings.settings.base_url ? { baseUrl: webSettings.settings.base_url } : {}),
      })
    : undefined;
  const disabledToolNames = BUILT_IN_TOOL_NAMES.filter((name) =>
    (isAvailable ? !isAvailable(name) : false) || (name === 'web_search' && !webSearch));
  return { webSearch, webFetch: createWebFetch(), disabledToolNames };
}

function createToolsForSnapshot(
  snapshot: ReturnType<typeof resolveToolSnapshot>,
  workspaceFileAccess: WorkspaceFileAccess,
  process: ToolProcessAdapter,
  skills?: Pick<SkillService, 'useSkill'>,
) {
  return createTools({
    workspaceFileAccess,
    process,
    ...(skills ? { skills } : {}),
    ...(snapshot.webSearch ? { webSearch: snapshot.webSearch } : {}),
    webFetch: snapshot.webFetch,
    disabledToolNames: snapshot.disabledToolNames as readonly BuiltInToolName[],
  });
}

function createNodeToolProcessAdapter(): ToolProcessAdapter {
  const shellKind = process.platform === 'win32' ? 'powershell' as const : 'posix_shell' as const;
  return {
    shellName: shellKind === 'powershell' ? 'Windows PowerShell 5.1' : 'POSIX shell',
    shellKind,
    executionMethod: 'shell',
    run(request, options) {
      return new Promise((resolve, reject) => {
        const executable = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const args = process.platform === 'win32'
          ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', request.command]
          : ['-lc', request.command];
        const child = spawn(executable, args, { cwd: request.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const abort = () => child.kill();
        options.signal.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', options.onStdout);
        child.stderr.on('data', options.onStderr);
        child.once('error', reject);
        child.once('close', (code) => {
          options.signal.removeEventListener('abort', abort);
          resolve({ exitCode: code ?? -1 });
        });
      });
    },
  };
}

function modelVisibleOperatingSystem(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

function trackProductRuns(engine: Engine, readModel: ProductRunReadModel): { engine: Engine; stopAccepting(): void } {
  let accepting = true;
  const tracked: Engine = {
    async startRun(request) {
      if (!accepting) return { status: 'failed', failure: { code: 'internal_error', message: 'Product is shutting down and is not accepting new Runs.' } };
      const result = await engine.startRun(request);
      if (result.status === 'started' || result.status === 'already_started' || result.status === 'session_busy') {
        readModel.recordRun(result.status === 'session_busy' ? result.activeRun : result.run);
      }
      return result;
    },
    async resumeRun(request) {
      if (!accepting) return { status: 'failed', failure: { code: 'internal_error', message: 'Product is shutting down and is not accepting Run resumes.' } };
      const result = await engine.resumeRun(request);
      if (result.status === 'resumed' || result.status === 'not_waiting' || result.status === 'already_resolved') readModel.recordRun(result.run);
      return result;
    },
    async cancelRun(request) {
      const result = await engine.cancelRun(request);
      if (result.status === 'cancellation_requested' || result.status === 'already_cancelling' || result.status === 'already_terminal') readModel.recordRun(result.run);
      return result;
    },
  };
  return { engine: tracked, stopAccepting: () => { accepting = false; } };
}

function finalizeWorkspaceChangesForTerminalEvent(
  event: RuntimeEvent,
  readModel: ProductRunReadModel,
  workspaceChanges: ReturnType<typeof createWorkspaceChanges>,
): void {
  if (!event.runId || !['run.completed', 'run.failed', 'run.cancelled'].includes(event.eventType)) return;
  const run = readModel.getRun(event.runId);
  if (!run) return;
  try {
    workspaceChanges.finalizeChangeSet({
      workspace_id: run.workspaceId,
      session_id: run.sessionId,
      run_id: run.runId,
      finalized_at: event.createdAt,
    });
  } catch {
    // Projection failure cannot rewrite the already-decided Run outcome.
  }
}

async function disposeProduct(input: {
  engineController: { engine: Engine; stopAccepting(): void };
  runReadModel: ProductRunReadModel;
  observability: { flush(): Promise<void> };
  database: DatabaseConnection;
}): Promise<void> {
  input.engineController.stopAccepting();
  await Promise.all(input.runReadModel.listLiveRunIds().map((runId) => input.engineController.engine.cancelRun({ runId })));
  if (!await input.runReadModel.waitForConvergence(PRODUCT_ENGINE_POLICY.cancellationTimeoutMs + 2_000)) {
    throw new Error('Product shutdown timed out while waiting for live Runs to become terminal.');
  }
  await input.observability.flush();
  input.database.close();
}


const unavailableWorkspaceFileAccess: WorkspaceFileAccess = {
  readBinaryFile: async () => { throw new Error('Run Workspace is unavailable.'); },
  readFile: async () => { throw new Error('Run Workspace is unavailable.'); },
  listDirectory: async () => { throw new Error('Run Workspace is unavailable.'); },
  walkFiles: async () => { throw new Error('Run Workspace is unavailable.'); },
  editFile: async () => { throw new Error('Run Workspace is unavailable.'); },
  replaceText: async () => { throw new Error('Run Workspace is unavailable.'); },
  writeFile: async () => { throw new Error('Run Workspace is unavailable.'); },
  createDirectory: async () => { throw new Error('Run Workspace is unavailable.'); },
  copyPath: async () => { throw new Error('Run Workspace is unavailable.'); },
  movePath: async () => { throw new Error('Run Workspace is unavailable.'); },
  deletePath: async () => { throw new Error('Run Workspace is unavailable.'); },
  resolveCommandCwd: async () => { throw new Error('Run Workspace is unavailable.'); },
};

const unavailableInputSourceAccess: InputSourceAccess = {
  async readImage() { throw new Error('Host image file reading is unavailable.'); },
  async resolveDocument() { throw new Error('Host document file resolution is unavailable.'); },
};

const noopObservabilityStorage: ObservabilityStorage = {
  ensureDirectory: async () => undefined,
  appendText: async () => undefined,
  readText: async () => '',
  listFiles: async () => [],
  stat: async () => undefined,
  move: async () => undefined,
  remove: async () => undefined,
};
