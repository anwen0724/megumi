// Composes the local desktop runtime by wiring src owner modules behind AppApi's AgentRuntimePort.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentRuntimeCancelRequest,
  AgentRuntimeEvent,
  AgentRuntimePort,
  AgentRuntimeResumeRequest,
  AgentRuntimeRetryRequest,
  AgentRuntimeStartRequest,
  AppErrorResponse,
  AppRunControlResponse,
  AppRunResponse,
  AppRunStatus,
  AppStartRunResponse,
} from '../../app';
import {
  ProviderRegistry,
  createOpenAICompatibleAdapter,
  stream as streamAssistantMessage,
  type AiRequestOptions,
  type AssistantMessageEventStream,
  type Model,
} from '../../ai';
import { type AgentAiClient, type AgentRunEvent, createAgentRunner } from '../../agent';
import { BUILT_IN_INPUT_COMMAND_REGISTRY } from '../../command';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqliteProjectRepository,
  SqlitePermissionRepository,
  SqliteRecoveryRepository,
  SqliteRuntimeEventRepository,
  SqliteSessionStateRepository,
  SqliteToolExecutionRepository,
  SqliteWorkspaceRepository,
  type SqliteDatabase,
} from '../../database';
import { parseRawInput, type ParsedInput, type RawInput } from '../../input';
import { evaluatePermissionPolicy, type PermissionRepository } from '../../permission';
import type { JsonObject, JsonValue } from '../../shared';
import { createSessionStateManager, type Session, type SessionStateRepository } from '../../session';
import { createBuiltInToolRegistry, createToolExecutionService, projectToolSetFromRegistry, type ToolProcessHost } from '../../tools';
import {
  createWorkspace,
  createWorkspaceManager,
  createWorkspaceRootAuthorization,
  type WorkspaceDirectoryEntry,
  type WorkspaceFileHost,
  type WorkspaceManager,
  type WorkspacePath,
} from '../../workspace';
import { DesktopIpcError, unavailable } from '../ipc/ipc-errors';
import { createAppSettingsStore, type AppSettingsStore } from '../infrastructure/app-settings-store';
import { initializeMegumiHome, type MegumiHomePaths } from '../infrastructure/megumi-home';
import { createProviderSettingsStore, type ProviderSettingsStore } from '../infrastructure/provider-settings-store';
import { createRuntimeJsonlLogger, type RuntimeLogger } from '../infrastructure/runtime-logger';
import { createRuntimeEventBus, type RuntimeEventBus } from './create-runtime-event-bus';
import { createHostAdapters, type DesktopHostAdapters } from './create-host-adapters';

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
  recoveryRepository: SqliteRecoveryRepository;
  runtimeLogger: RuntimeLogger;
  sessionRepository: SessionStateRepository;
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

const defaultModel: Model = { providerId: 'desktop-unconfigured', modelId: 'desktop-unconfigured' };

export function createLocalDesktopRuntime(options: CreateLocalDesktopRuntimeOptions = {}): LocalDesktopRuntime {
  const eventBus = options.eventBus ?? createRuntimeEventBus();
  const hosts = options.hosts ?? createHostAdapters();
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? createStableId;
  const megumiHomePaths = initializeMegumiHome({
    env: process.env,
    homeDirectory: path.dirname(hosts.megumiHomeHost.getMegumiHome()),
    now: () => new Date(now()),
  });
  const databasePath = options.databasePath ?? megumiHomePaths.databasePath;
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = openSqliteDatabase(databasePath);
  runDatabaseMigrations(database, { now });
  const sessionRepository = new SqliteSessionStateRepository(database);
  const projectRepository = new SqliteProjectRepository(database);
  const runtimeEventRepository = new SqliteRuntimeEventRepository(database);
  const recoveryRepository = new SqliteRecoveryRepository(database, sessionRepository);
  const permissionRepository = new SqlitePermissionRepository(database);
  const toolExecutionRepository = new SqliteToolExecutionRepository(database);
  const workspaceRepository = new SqliteWorkspaceRepository(database);
  const settingsStore = createAppSettingsStore({ settingsPath: megumiHomePaths.settingsPath });
  const providerSettingsStore = createProviderSettingsStore({
    settings: settingsStore,
    env: hosts.environmentHost,
  });
  const runtimeLogger = createRuntimeJsonlLogger({ filePath: megumiHomePaths.runtimeLogPath, now });
  const sessionManager = createSessionStateManager({ repository: sessionRepository, now, createId });
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
    repository: workspaceRepository,
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
    executionRepository: toolExecutionRepository,
    now,
    createId,
  });
  const ai: AgentAiClient = options.ai ?? {
    stream(model, context, aiOptions, toolSet) {
      return streamAssistantMessage(model, context, aiOptions, toolSet);
    },
  };

  function publishRuntimeEvent(event: AgentRuntimeEvent): void {
    const enriched = enrichRuntimeEvent(event);
    runtimeEventRepository.saveEvent(enriched);
    eventBus.publish(enriched);
  }

  function enrichRuntimeEvent(event: AgentRuntimeEvent): AgentRuntimeEvent {
    const payloadSessionId = typeof event.payload?.sessionId === 'string' ? event.payload.sessionId : undefined;
    const payloadWorkspaceId = typeof event.payload?.workspaceId === 'string' ? event.payload.workspaceId : undefined;
    const run = event.runId ? sessionRepository.getRunRecord(event.runId) : undefined;
    const sessionId = event.sessionId ?? payloadSessionId ?? run?.sessionId;
    const session = sessionId ? sessionRepository.getSession(sessionId) : undefined;
    const metadataWorkspaceId = typeof run?.metadata?.workspaceId === 'string' ? run.metadata.workspaceId : undefined;
    const workspaceId = event.workspaceId ?? payloadWorkspaceId ?? metadataWorkspaceId ?? session?.workspaceId;

    return {
      ...event,
      ...(sessionId ? { sessionId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };
  }

  const runner = createAgentRunner({
    sessionManager,
    sessionRepository,
    permissionRepository,
    permissionEvaluator,
    toolRegistry,
    toolSet: projectToolSetFromRegistry(toolRegistry).tools,
    toolExecutor: toolExecutionService,
    ai,
    model: options.model ?? defaultModel,
    aiOptions: options.aiOptions ?? {
      registry: createProviderRegistry(providerSettingsStore),
      credentialResolver: providerSettingsStore,
    },
    systemInstruction: options.systemInstruction ?? 'You are Megumi.',
    now,
    createId,
    emit: (event) => publishRuntimeEvent(mapAgentRunEventToRuntimeEvent(event)),
  });

  const parseByRunId = new Map<string, ParsedInput>();

  const agentRuntime: AgentRuntimePort = {
    async startRun(request) {
      const session = ensureSession({ request, sessionRepository, sessionManager, now });
      const parsedInput = parseRuntimeInput(request, now, createId);
      const result = await runner.startRun({
        parsedInput,
        sessionId: session.id,
        workspaceId: request.workspaceId,
        model: modelFromRequest(request, providerSettingsStore, settingsStore),
        options: {
          maxTurns: numberOption(request.metadata?.maxTurns, 4),
          maxToolCalls: numberOption(request.metadata?.maxToolCalls, 8),
          permissionMode: permissionModeOption(request.permissionMode),
        },
      });
      if (result.kind === 'not_agent_run') {
        return {
          runId: result.parsedInputId,
          sessionId: session.id,
          workspaceId: request.workspaceId,
          status: 'completed',
          metadata: { reason: result.reason },
        };
      }
      parseByRunId.set(result.result.run.id, parsedInput);
      return mapAgentResultToAppResponse(result.result);
    },
    async resumeRun(request) {
      if (!request.approvalRequestId) {
        throw unavailable('run.resume', 'approvalRequestId is required to resume an Agent Run');
      }
      const parsedInput = getParsedInputForRun(request.runId, request.sessionId, request.workspaceId);
      const sessionId = request.sessionId ?? parsedInput.sessionId;
      if (!sessionId) {
        throw unavailable('run.resume', `sessionId is required to resume run ${request.runId}`);
      }
      const result = await runner.resumeRun({
        runId: request.runId,
        sessionId,
        workspaceId: request.workspaceId,
        parsedInput,
        approvalRequestId: request.approvalRequestId,
        userDecision: {
          kind: resumeDecisionKind(request),
          decidedAt: now(),
        },
        options: {
          maxTurns: numberOption(request.metadata?.maxTurns, 4),
          maxToolCalls: numberOption(request.metadata?.maxToolCalls, 8),
          permissionMode: permissionModeOption(request.metadata?.permissionMode),
        },
      });
      return mapAgentResultToAppResponse(result);
    },
    async cancelRun(request: AgentRuntimeCancelRequest): Promise<AppRunControlResponse> {
      if (!request.runId) throw unavailable('run.cancel', 'runId is required');
      const run = sessionRepository.getRunRecord(request.runId);
      if (!run) throw unavailable('run.cancel', `run record was not found: ${request.runId}`);
      recoveryRepository.saveCancelRequest({
        cancelRequestId: createId('cancel-request', `${request.runId}-${now()}`),
        runId: request.runId,
        sessionId: request.sessionId ?? run.sessionId,
        workspaceId: request.workspaceId,
        reason: request.reason ?? 'user_requested',
        createdAt: now(),
        metadata: jsonObjectOrUndefined(request.metadata),
      });
      publishRuntimeEvent({
        type: 'run.cancel.requested',
        runId: request.runId,
        sessionId: request.sessionId ?? run.sessionId,
        workspaceId: request.workspaceId,
        occurredAt: now(),
        payload: { reason: request.reason ?? 'user_requested' },
      });
      const cancelled = sessionManager.updateRunStatus({
        runId: request.runId,
        status: 'cancelled',
        endedAt: now(),
        metadata: { ...(run.metadata ?? {}), cancelledBy: 'desktop' },
      });
      publishRuntimeEvent({
        type: 'run.cancelled',
        runId: request.runId,
        sessionId: cancelled.sessionId,
        workspaceId: request.workspaceId,
        occurredAt: now(),
        payload: { reason: request.reason ?? 'user_requested' },
      });
      return {
        runId: cancelled.id,
        sessionId: cancelled.sessionId,
        workspaceId: request.workspaceId,
        status: 'cancelled',
      };
    },
    async retryRun(request: AgentRuntimeRetryRequest): Promise<AppRunControlResponse> {
      if (!request.runId) throw unavailable('run.retry', 'runId is required');
      const run = sessionRepository.getRunRecord(request.runId);
      if (!run) throw unavailable('run.retry', `run record was not found: ${request.runId}`);
      const sessionId = request.sessionId ?? run.sessionId;
      const retryKind = request.metadata?.retryKind === 'manual_retry' ? 'manual_retry' : 'manual_rerun';
      recoveryRepository.saveRetryRequest({
        retryRequestId: createId('retry-request', `${request.runId}-${now()}`),
        runId: request.runId,
        sessionId,
        workspaceId: request.workspaceId,
        retryKind,
        reason: request.reason ?? run.status,
        createdAt: now(),
        metadata: jsonObjectOrUndefined(request.metadata),
      });
      sessionManager.recordRerun({
        idSeed: `rerun-${request.runId}-${now()}`,
        sourceEntryIdSeed: `source-rerun-${request.runId}-${now()}`,
        sessionId,
        targetRunId: request.runId,
        attemptNumber: sessionRepository.listRetryAttempts(sessionId).length + 1,
        metadata: { retryKind, sourceRunId: request.runId },
      });
      publishRuntimeEvent({
        type: 'run.retry.requested',
        runId: request.runId,
        sessionId,
        workspaceId: request.workspaceId,
        occurredAt: now(),
        payload: { retryKind, reason: request.reason ?? run.status },
      });
      const parsedInput = {
        id: createId('parsed-input', `retry-${request.runId}-${now()}`),
        rawInputId: createId('raw-input', `retry-${request.runId}-${now()}`),
        source: { kind: 'desktop' as const },
        rawKind: 'text' as const,
        kind: 'user_input' as const,
        text: run.inputSummary,
        attachments: [],
        references: [],
        facts: [],
        createdAt: now(),
        ...(request.workspaceId ? { target: { kind: 'workspace' as const, workspaceId: request.workspaceId } } : {}),
      };
      const result = await runner.startRun({
        parsedInput,
        sessionId,
        workspaceId: request.workspaceId,
        options: {
          maxTurns: numberOption(request.metadata?.maxTurns, 4),
          maxToolCalls: numberOption(request.metadata?.maxToolCalls, 8),
          permissionMode: permissionModeOption(request.metadata?.permissionMode),
        },
      });
      if (result.kind === 'not_agent_run') {
        return { runId: request.runId, sessionId, workspaceId: request.workspaceId, status: 'completed' };
      }
      return mapAgentResultToAppResponse(result.result);
    },
    subscribe(callback: (event: AgentRuntimeEvent) => void) {
      return eventBus.subscribe(callback);
    },
  };

  return {
    agentRuntime,
    eventBus,
    hosts,
    database,
    megumiHomePaths,
    settingsStore,
    providerSettingsStore,
    projectRepository,
    runtimeEventRepository,
    recoveryRepository,
    runtimeLogger,
    sessionRepository,
    sessionManager,
    permissionRepository,
    permissionEvaluator,
    toolRegistry,
    toolExecutionService,
    toolExecutionRepository,
    workspaceRepository,
    workspaceManager,
    async start() {},
    async stop() {
      database.close();
    },
  };

  function getParsedInputForRun(runId: string, sessionId?: string, workspaceId?: string): ParsedInput & { sessionId?: string } {
    const existing = parseByRunId.get(runId);
    if (existing) return { ...existing, sessionId };
    const run = sessionRepository.getRunRecord(runId);
    if (!run) {
      throw unavailable('run.resume', `run record was not found: ${runId}`);
    }
    return {
      id: String(run.metadata?.parsedInputId ?? run.id),
      rawInputId: String(run.metadata?.parsedInputId ?? run.id),
      source: { kind: 'desktop' },
      rawKind: 'system',
      kind: 'user_input',
      text: run.inputSummary,
      attachments: [],
      references: [],
      facts: [],
      createdAt: run.startedAt,
      ...(workspaceId ? { target: { kind: 'workspace' as const, workspaceId } } : {}),
      sessionId: sessionId ?? run.sessionId,
    };
  }
}

function ensureSession(input: {
  request: AgentRuntimeStartRequest;
  sessionRepository: SessionStateRepository;
  sessionManager: ReturnType<typeof createSessionStateManager>;
  now: () => string;
}): Session {
  const sessionId = input.request.sessionId ?? `session-${input.request.client.requestId}`;
  const existing = input.sessionRepository.getSession(sessionId);
  if (existing) return existing;

  // Desktop receives renderer-owned session ids. Creating the boundary fact with that exact id preserves the renderer contract;
  // subsequent session state transitions still go through SessionStateManager.
  return input.sessionRepository.createSession({
    id: sessionId as Session['id'],
    title: titleFromInput(input.request.rawInput.text),
    status: 'active',
    workspaceId: input.request.workspaceId,
    workspacePath: stringMetadata(input.request.rawInput.metadata, 'workspacePath')
      ?? stringMetadata(input.request.metadata, 'workspacePath'),
    createdAt: input.now(),
    updatedAt: input.now(),
    metadata: { createdBy: 'desktop-runtime' },
  });
}

function parseRuntimeInput(
  request: AgentRuntimeStartRequest,
  now: () => string,
  createId: (prefix: string, value: string) => string,
): ParsedInput {
  const rawInput: RawInput = {
    id: request.rawInput.id ?? createId('raw-input', request.client.requestId),
    source: {
      kind: isInputSourceKind(request.rawInput.source?.kind) ? request.rawInput.source.kind : 'desktop',
      metadata: jsonObjectOrUndefined(request.rawInput.source),
    },
    text: request.rawInput.text ?? '',
    attachments: [],
    references: [],
    metadata: jsonObjectOrUndefined(request.rawInput.metadata ?? request.metadata),
    createdAt: request.rawInput.createdAt ?? now(),
  };
  return parseRawInput(rawInput, { commandRegistry: BUILT_IN_INPUT_COMMAND_REGISTRY, now, createId });
}

function mapAgentRunEventToRuntimeEvent(event: AgentRunEvent): AgentRuntimeEvent {
  const payload = 'payload' in event ? event.payload : {};
  return {
    type: event.type,
    runId: event.runId,
    occurredAt: event.occurredAt,
    payload: {
      ...('turnIndex' in event ? { turnIndex: event.turnIndex } : {}),
      ...('status' in event ? { status: event.status } : {}),
      ...('event' in event ? { event: event.event as unknown as JsonValue } : {}),
      ...payload,
    },
  };
}

function mapAgentResultToAppResponse(result: {
  run: { id: string; sessionId: string; workspaceId?: string };
  status: AppRunStatus;
  waiting?: unknown;
  error?: { code: string; message: string; details?: JsonObject };
}): AppRunResponse {
  return {
    runId: result.run.id,
    sessionId: result.run.sessionId,
    workspaceId: result.run.workspaceId,
    status: result.status,
    ...(result.waiting && typeof result.waiting === 'object' ? { waiting: result.waiting as Record<string, unknown> } : {}),
    ...(result.error ? { error: mapError(result.error) } : {}),
  };
}

function mapError(error: { code: string; message: string; details?: JsonObject }): AppErrorResponse {
  return {
    code: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  };
}

function createWorkspaceFileHost(root: string): WorkspaceFileHost {
  const resolveWorkspacePath = (workspacePath: WorkspacePath): string => {
    const resolved = path.resolve(root, String(workspacePath));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new DesktopIpcError('workspace_path_escape', 'Workspace path escaped the configured project root.');
    }
    return resolved;
  };

  return {
    async readTextFile(workspacePath) {
      return fsp.readFile(resolveWorkspacePath(workspacePath), 'utf8');
    },
    async writeTextFile(workspacePath, content) {
      const target = resolveWorkspacePath(workspacePath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
    },
    async deleteFile(workspacePath) {
      await fsp.rm(resolveWorkspacePath(workspacePath), { force: true });
    },
    async fileExists(workspacePath) {
      try {
        await fsp.access(resolveWorkspacePath(workspacePath));
        return true;
      } catch {
        return false;
      }
    },
    async listDirectory(workspacePath) {
      const absolute = resolveWorkspacePath(workspacePath);
      const entries = await fsp.readdir(absolute, { withFileTypes: true });
      return entries.map((entry): WorkspaceDirectoryEntry => ({
        name: entry.name,
        path: path.posix.join(String(workspacePath).replaceAll('\\', '/'), entry.name) as WorkspacePath,
        kind: entry.isDirectory() ? 'directory' : 'file',
      }));
    },
  };
}

function createToolProcessHost(hosts: DesktopHostAdapters): ToolProcessHost {
  return {
    runCommand(input) {
      return new Promise((resolve, reject) => {
        const child = hosts.processHost.spawn(input.command, {
          cwd: input.cwd,
          shell: true,
          env: input.envPolicy === 'none' ? {} : process.env,
        });
        let stdout = '';
        let stderr = '';
        const timer = input.timeoutMs ? setTimeout(() => child.kill(), input.timeoutMs) : undefined;
        child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', reject);
        child.on('close', (exitCode) => {
          if (timer) clearTimeout(timer);
          resolve({ exitCode: exitCode ?? 0, stdout, stderr });
        });
      });
    },
  };
}

function createStableId(prefix: string, value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9:_-]/g, '_') || 'local';
  if (normalized.startsWith(`${prefix}_`) || normalized.startsWith(`${prefix}-`)) {
    return normalized;
  }
  return `${prefix}_${normalized}`;
}

function titleFromInput(text: string | undefined): string {
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, 80) : 'New session';
}

function numberOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function permissionModeOption(value: unknown): 'default' | 'plan' | 'accept_edits' | 'auto' {
  return value === 'plan' || value === 'accept_edits' || value === 'auto' ? value : 'default';
}

function modelFromRequest(
  request: AgentRuntimeStartRequest,
  providerSettingsStore: ProviderSettingsStore,
  settingsStore: AppSettingsStore,
): Model {
  const providerId = isProviderId(request.providerId)
    ? request.providerId
    : settingsStore.getResolvedSettings().chat.defaultProvider;
  const settings = providerSettingsStore.getProviderSettings(providerId);
  return {
    providerId,
    modelId: typeof request.modelId === 'string' && request.modelId.trim()
      ? request.modelId.trim()
      : settings.defaultModel,
  };
}

function isProviderId(value: unknown): value is 'deepseek' | 'openai' | 'anthropic' {
  return value === 'deepseek' || value === 'openai' || value === 'anthropic';
}

function resumeDecisionKind(request: AgentRuntimeResumeRequest): 'allow_once' | 'allow_for_session' | 'deny' {
  if (request.decision === 'deny') return 'deny';
  if (
    request.metadata?.decision === 'allow_for_session'
    || request.metadata?.approvalScope === 'session'
    || request.metadata?.scope === 'session'
  ) {
    return 'allow_for_session';
  }
  return 'allow_once';
}

function isInputSourceKind(value: unknown): value is RawInput['source']['kind'] {
  return value === 'composer' || value === 'quick_action' || value === 'system' || value === 'desktop' || value === 'app';
}

function jsonObjectOrUndefined(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stringMetadata(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function createProviderRegistry(providerSettingsStore: ProviderSettingsStore): ProviderRegistry {
  const deepseek = providerSettingsStore.getProviderSettings('deepseek');
  const openai = providerSettingsStore.getProviderSettings('openai');
  return new ProviderRegistry([
    createOpenAICompatibleAdapter({
      providerId: 'deepseek',
      baseUrl: deepseek.baseUrl ?? 'https://api.deepseek.com',
      fetch,
    }),
    createOpenAICompatibleAdapter({
      providerId: 'openai',
      baseUrl: openai.baseUrl ?? 'https://api.openai.com/v1',
      fetch,
    }),
  ]);
}
