/*
 * Composes the Agent runtime exposed to Product Composition.
 * Host-facing adaptation is owned by packages/product.
 */
import { readFile, readdir } from 'node:fs/promises';
import { ArtifactContentStore } from '../artifacts/artifact-content-store';
import { ArtifactService, PlanArtifactCompatibilityService, PlanArtifactService } from '../artifacts';
import {
  createAgentRunService,
  createModelCallService,
  type AgentRunTraceLogger,
  type AgentRunService,
  type ModelCallService,
} from '../agent-run';
import { ActiveRunStore } from '../agent-run/core/active-run-store';
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
} from './compose-agent-tool-runtime';
import { composeAgentContext, type ContextCapacity } from '../context';
import { composeAgentInstructions } from '../instructions';
import { composeAgentSkills, type Skill, type SkillService } from '../skills';
import {
  createSettingsService,
  type MemorySettingsPort,
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
import {
  createAiClient,
  createAnthropicProtocolAdapter,
  createOpenAICompatibleProtocolAdapter,
  createRequestTokenCounter,
  ProtocolRegistry,
  AssistantEventStream,
  type AiClient,
  type AiCallRequest,
  type AssistantMessage,
  type AssistantStreamEvent,
} from '@megumi/ai';
import type { ObservabilityService, SpanHandle, TraceHandle } from '@megumi/observability';
import type { RuntimeEvent } from '../events';
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

type ImplementationPlanArtifactRecord = {
  planArtifactId: string;
  producingRunId: string;
  title: string;
  status: 'draft' | 'proposed' | 'accepted' | 'rejected' | 'superseded';
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
  supersededAt?: string;
  supersededByPlanId?: string;
  metadata?: CompositionJsonObject;
};

type CompositionJsonPrimitive = string | number | boolean | null;
type CompositionJsonValue = CompositionJsonPrimitive | CompositionJsonObject | CompositionJsonValue[];
type CompositionJsonObject = { [key: string]: CompositionJsonValue };

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
  aiClient?: AiClient;
  modelCallProviderService?: LegacyModelCallProviderForTests;
  modelContextProvider?: ModelContextProvider;
  appSettingsProvider?: unknown;
  memorySettingsProvider?: MemorySettingsPort;
  workspaceChangeFooterProjector?: unknown;
  projectFileSystem?: LocalWorkspaceServiceFileSystem;
  settingsStorage?: SettingsFileStore;
  inputFileReader?: InputFileReader;
  sessionAttachmentFileSystem?: SessionAttachmentFileSystem;
}

export interface AgentRuntime {
  agentRunService: AgentRunService;
  modelCallService: ModelCallService;
  inputService: InputService;
  commandService: CommandService;
  skillService: SkillService;
  sessionService: SessionService;
  sessionBranchService: SessionBranchService;
  settingsService: SettingsService;
  workspaceService: WorkspaceService;
  workspaceFilesService: WorkspaceFilesService;
  workspaceChangeService: WorkspaceChangeService;
  workspacePathPolicyService: WorkspacePathPolicyService;
  permissionService: PermissionService;
  artifactService: ArtifactService;
  planArtifactService: PlanArtifactService;
  contextRuntime: ReturnType<typeof composeAgentContext>;
  sessionTimelineQuery: SessionTimelineQuery;
  modelContextProvider: ModelContextProvider;
  dispose(): void;
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

type LegacyModelCallProviderForTests = {
  streamModelCall(request: {
    sessionId: string;
    runId: string;
    stepId: string;
  }): AsyncIterable<RuntimeEvent> | Promise<AsyncIterable<RuntimeEvent>>;
  completeModelCall?(request: unknown): Promise<{ ok: true; text: string } | { ok: false; error: unknown }>;
  cancelModelCall?(request: unknown): boolean;
};

export function composeAgentRuntime(options: ComposeAgentRuntimeOptions): AgentRuntime {
  const persistence = composeAgentPersistence({
    sqlitePath: options.homePaths.sqlitePath,
    migrationsFolder: options.migrationsFolder,
    migrationEnvironment: options.migrationEnvironment,
  });
  const workspaceRepository = new WorkspaceRepository(persistence.database);
  const workspaceChangeRepository = new WorkspaceChangeRepository(persistence.database);
  const sessionRepository = new SessionV2Repository(persistence.database);
  const activeRunStore = new ActiveRunStore();
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
  });
  const agentRunSettingsService = options.aiClient || options.modelCallProviderService
    ? createModelConfigSettingsFacade(settingsService)
    : settingsService;
  const workspaceFileSystem = options.projectFileSystem ?? createLocalProjectFileSystem();
  const workspacePathPolicyService = createWorkspacePathPolicyService();
  const workspaceService = createWorkspaceService({
    repository: workspaceRepository,
    file_system: workspaceFileSystem,
  });
  const skillRuntime = composeAgentSkills({
    database: persistence.database,
    homePath: options.homePaths.homePath,
    workspaceService,
  });
  const commandService = createCommandService({
    skillCommandProvider: {
      async listSkillCommands(request) {
        const skills = await skillRuntime.skillService.listSkills({
          ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
        });
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
    isRunLive: (runId) => {
      const active = activeRunStore.getRun(runId);
      return Boolean(active && !['completed', 'failed', 'cancelled'].includes(active.status));
    },
    workspaceChangeFooterProjector,
  });
  const workspaceFilesService = createWorkspaceFilesService({
    workspaceService,
    pathPolicy: workspacePathPolicyService,
    fileSystem: createLocalWorkspaceFilesFileSystem(),
  });
  const permissionService = createPermissionService({
    settings_service: {
      addPermissionRule(request) {
        return settingsService.addPermissionRule({
          rule: request.rule,
          session_id: request.session_id,
        });
      },
    },
  });
  const agentRunTraceLogger = createObservabilityAgentRunTraceLogger(options.observabilityService);
  const protocolRegistry = createProtocolRegistry();
  const modelCallService = createModelCallService({
    ai_client: options.aiClient
      ?? (options.modelCallProviderService ? aiClientFromLegacyProvider(options.modelCallProviderService) : undefined)
      ?? createAiClient({ registry: protocolRegistry }),
    request_token_counter: createRequestTokenCounter(protocolRegistry),
  });
  const instructionService = composeAgentInstructions({
    megumiHomePath: options.homePaths.homePath,
    fileSystem: {
      readFile: (filePath) => readFile(filePath, 'utf8'),
      readDirectory: (directoryPath) => readdir(directoryPath),
    },
  });
  const modelContextProvider = options.modelContextProvider ?? createSettingsModelContextProvider(settingsService);
  const contextRuntime = composeAgentContext({
    sessionService,
    isRunLive: (runId) => {
      const active = activeRunStore.getRun(runId);
      return Boolean(active && !['completed', 'failed', 'cancelled'].includes(active.status));
    },
    instructionScopeResolver: {
      resolve({ workspaceId }) {
        const workspace = workspaceService.getWorkspace({ workspace_id: workspaceId });
        return workspace.status === 'found'
          ? { status: 'resolved', workspaceRoot: workspace.workspace.root_path, workingDirectory: workspace.workspace.root_path }
          : { status: 'failed', failure: { code: 'workspace_not_found', message: `Workspace ${workspaceId} was not found.` } };
      },
    },
    instructionService,
    skillService: skillRuntime.skillService,
    policyProvider: {
      getPolicy() {
        const resolved = settingsService.getResolvedSettings();
        return resolved.status === 'ok'
          ? { compactionThresholdRatio: resolved.settings.context.compaction_threshold_ratio }
          : {};
      },
    },
    modelCallService,
    ...(options.observabilityService ? { observability: options.observabilityService } : {}),
    modelRuntimeConfigResolver: {
      resolve({ providerId, modelId }) {
        const resolved = agentRunSettingsService.resolveProviderRuntimeConfig({
          provider_id: providerId,
          model_id: modelId,
        });
        return resolved.status === 'ok'
          ? { status: 'resolved', modelConfig: resolved.config }
          : { status: 'failed', failure: resolved.failure };
      },
    },
  });
  const artifactContentStore = new ArtifactContentStore({
    artifactRoot: `${options.homePaths.homePath}/artifacts`,
  });
  const artifactService = new ArtifactService({
    repository: persistence.artifactRepository,
    contentStore: artifactContentStore,
  });
  const planArtifactCompatibility = new PlanArtifactCompatibilityService({
    repository: persistence.artifactRepository,
  });
  const planArtifactService = new PlanArtifactService({
    repository: createInMemoryPlanArtifactRepository(),
    planArtifactCompatibility,
  });
  const agentRunService = createAgentRunService({
    active_run_store: activeRunStore,
    input_service: inputService,
    command_service: commandService,
    command_execution_context_provider: ({ request, session_id }) => {
      const providerConfig = agentRunSettingsService.resolveProviderRuntimeConfig({
        provider_id: request.model_selection.provider_id,
        model_id: request.model_selection.model_id,
      });
      return {
        session_id,
        workspace_id: request.workspace_id,
        services: {
          context: contextRuntime.contextService,
        },
        model_context: modelContextProvider({
          providerId: request.model_selection.provider_id,
          modelId: request.model_selection.model_id,
        }),
        image_input_support: providerConfig.status === 'ok'
          ? providerConfig.config.capabilities.imageInput
          : 'unknown',
      };
    },
    session_service: sessionService,
    branch_service: sessionBranchService,
    settings_service: agentRunSettingsService,
    context_service: contextRuntime.contextService,
    model_context_provider: modelContextProvider,
    model_call_service: modelCallService,
    skill_service: skillRuntime.skillService,
    tool_registry_service: toolRegistry,
    tool_execution_service_factory: ({ run_id, session_id, workspace_id, workspace_root }) => {
      const webSearchConfig = resolveWebSearchConfig();
      const runToolRegistry = composeAgentToolRegistryService({
        webSearchEnabled: Boolean(webSearchConfig),
      });
      const toolExecutionService = composeAgentToolExecutionService({
        projectRoot: workspace_root ?? process.cwd(),
        registryService: runToolRegistry,
        workspacePathPolicyService,
        skillService: skillRuntime.skillService,
        ...(webSearchConfig ? { webSearchService: createWebSearchService(webSearchConfig) } : {}),
        runContext: {
          runId: run_id,
          sessionId: session_id,
          workspaceId: workspace_id,
        },
      });
      return {
        executeTool(request) {
          return workspaceChangeService.trackToolExecution({
            scope: { run_id, session_id, workspace_id },
            tool_execution: {
              tool_name: request.toolName,
              input: request.input,
              workspace_root: workspace_root ?? process.cwd(),
            },
            execute: () => Promise.resolve(toolExecutionService.executeTool(request)),
          });
        },
      };
    },
    permission_service: permissionService,
    trace_logger: agentRunTraceLogger,
    ...(options.observabilityService ? { observability: options.observabilityService } : {}),
    workspace_service: workspaceService,
    workspace_path_policy_service: workspacePathPolicyService,
    event_publisher: {
      publish(event) {
        finalizeWorkspaceChangesForTerminalRunEvent({
          event,
          activeRuns: activeRunStore,
          workspaceChanges: workspaceChangeService,
        });
      },
    },
  });
  return {
    agentRunService,
    modelCallService,
    inputService,
    commandService,
    skillService: skillRuntime.skillService,
    sessionService,
    sessionBranchService,
    settingsService,
    workspaceService,
    workspaceFilesService,
    workspaceChangeService,
    workspacePathPolicyService,
    permissionService,
    artifactService,
    planArtifactService,
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

export function createObservabilityAgentRunTraceLogger(
  observability?: ObservabilityService,
): AgentRunTraceLogger {
  if (!observability) return { record: () => undefined };
  const modelSpans = new Map<string, SpanHandle>();
  const toolSpans = new Map<string, SpanHandle>();

  return {
    record(record) {
      if (
        record.event_type === 'run.started'
        || record.event_type === 'run.completed'
        || record.event_type === 'run.failed'
        || record.event_type === 'trace.prompt.built'
      ) {
        // ContextService owns the real prompt-preparation span and measurements.
        return;
      }

      if (record.event_type === 'trace.model_call.request_payload' && record.model_call_id) {
        const span = observability.startSpan({
          name: 'model.call',
          attributes: {
            providerId: record.payload.provider_id,
            modelId: record.payload.model_id,
          },
        });
        modelSpans.set(record.model_call_id, span);
        return;
      }

      if (record.event_type === 'trace.model_call.event_received' && record.model_call_id) {
        const event = record.payload.event as {
          type?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        } | undefined;
        const span = modelSpans.get(record.model_call_id);
        const correlation = span?.context ?? {
          traceId: record.trace_id,
          runId: record.run_id,
          sessionId: record.session_id,
          workspaceId: record.workspace_id,
        };

        if (event?.usage?.input_tokens !== undefined) {
          observability.recordMeasurement({
            name: 'model.input_tokens',
            value: event.usage.input_tokens,
            unit: 'token',
            correlation,
          });
        }
        if (event?.usage?.output_tokens !== undefined) {
          observability.recordMeasurement({
            name: 'model.output_tokens',
            value: event.usage.output_tokens,
            unit: 'token',
            correlation,
          });
        }

        if (
          event?.type === 'completed'
          || event?.type === 'failed'
          || event?.type === 'cancelled'
        ) {
          if (span) {
            observability.endSpan({
              span,
              status: event.type === 'completed'
                ? 'ok'
                : event.type === 'cancelled'
                  ? 'cancelled'
                  : 'error',
            });
            modelSpans.delete(record.model_call_id);
          }
        }
        return;
      }

      if (record.event_type === 'trace.tool_call.requested' && record.tool_call_id) {
        const span = observability.startSpan({
          name: 'tool.call',
          attributes: { toolName: record.payload.tool_name },
        });
        toolSpans.set(record.tool_call_id, span);
        return;
      }

      if (record.event_type === 'trace.tool_execution.result' && record.tool_call_id) {
        const span = toolSpans.get(record.tool_call_id);
        if (span) {
          observability.endSpan({
            span,
            status: record.payload.status === 'completed' ? 'ok' : 'error',
            attributes: {
              resultBytes: typeof record.payload.output_size === 'number'
                ? record.payload.output_size
                : undefined,
            },
          });
          toolSpans.delete(record.tool_call_id);
        }
        return;
      }

      observability.recordLog({
        level: record.event_type.includes('failed') ? 'warn' : 'info',
        event: record.event_type,
        correlation: {
          traceId: record.trace_id,
          runId: record.run_id,
          sessionId: record.session_id,
          workspaceId: record.workspace_id,
        },
      });
    },
  };
}

function toSkillCommandDescriptor(skill: Skill): SkillCommandDescriptor {
  return {
    skillId: skill.skillId,
    commandName: commandNameFromSkillName(skill.name),
    skillName: skill.name,
    description: skill.description,
    sourceLabel: skill.source.label,
  };
}

function commandNameFromSkillName(skillName: string): string {
  const segments = skillName.split(':').filter(Boolean);
  return segments.at(-1) ?? skillName;
}

function createProtocolRegistry(): ProtocolRegistry {
  return new ProtocolRegistry([
    createOpenAICompatibleProtocolAdapter({ fetch }),
    createAnthropicProtocolAdapter({ fetch }),
  ]);
}

function createModelConfigSettingsFacade(settingsService: SettingsService): Pick<SettingsService, 'resolveProviderRuntimeConfig' | 'resolvePermissionSettings'> {
  return {
    resolvePermissionSettings: (request) => settingsService.resolvePermissionSettings(request),
    resolveProviderRuntimeConfig(request) {
      const result = settingsService.resolveProviderRuntimeConfig(request);
      if (result.status === 'ok') {
        return result;
      }
      const resolved = settingsService.getResolvedSettings();
      const provider = resolved.status === 'ok' ? resolved.settings.providers[request.provider_id] : undefined;
      if (!provider || !provider.enabled || !provider.models[request.model_id]) {
        return result;
      }
      return {
        status: 'ok',
        config: {
          provider_id: request.provider_id,
          protocol: provider.protocol,
          ...(provider.base_url ? { base_url: provider.base_url } : {}),
          model_id: request.model_id,
          capabilities: provider.models[request.model_id]!.capabilities,
        },
      };
    },
  };
}

function aiClientFromLegacyProvider(provider: LegacyModelCallProviderForTests): AiClient {
  return {
    stream(request: AiCallRequest) {
      return AssistantEventStream.from(legacyRuntimeEventsToAssistantEvents(provider, request));
    },
    async complete(request: AiCallRequest): Promise<AssistantMessage> {
      const result = await provider.completeModelCall?.(request);
      if (!result || !result.ok) {
        return {
          role: 'assistant',
          content: [],
          stopReason: 'error',
        };
      }
      return {
        role: 'assistant',
        content: [{ type: 'text', text: result.text }],
        stopReason: 'end_turn',
      };
    },
  };
}

async function* legacyRuntimeEventsToAssistantEvents(
  provider: LegacyModelCallProviderForTests,
  request: AiCallRequest,
): AsyncIterable<AssistantStreamEvent> {
  const runId = String(request.metadata?.runId ?? `run:${crypto.randomUUID()}`);
  const stepId = String(request.metadata?.stepId ?? `step:${crypto.randomUUID()}`);
  const sessionId = String(request.metadata?.sessionId ?? `session:${crypto.randomUUID()}`);
  const events = await provider.streamModelCall({ runId, stepId, sessionId });
  let finalText = '';

  for await (const event of events) {
    if (event.eventType === 'assistant.output.delta') {
      const delta = stringPayload(event, 'delta') ?? '';
      finalText += delta;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: delta },
      };
      continue;
    }
    if (event.eventType === 'assistant.output.completed') {
      finalText = stringPayload(event, 'content') ?? finalText;
      continue;
    }
    if (event.eventType === 'tool.call.created') {
      yield {
        type: 'content_block_start',
        index: 0,
        block: {
          type: 'toolCall',
          id: stringPayload(event, 'toolCallId'),
          name: stringPayload(event, 'toolName'),
          argumentsText: JSON.stringify(payloadValue(event, 'input') ?? {}),
        },
      };
    }
  }

  yield {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: finalText ? [{ type: 'text', text: finalText }] : [],
      stopReason: 'end_turn',
    },
  };
}

function payloadValue(event: RuntimeEvent, key: string): unknown {
  const payload = event.payload;
  return payload && typeof payload === 'object' && key in payload
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

function stringPayload(event: RuntimeEvent, key: string): string | undefined {
  const value = payloadValue(event, key);
  return typeof value === 'string' ? value : undefined;
}

export function finalizeWorkspaceChangesForTerminalRunEvent(input: {
  event: RuntimeEvent;
  activeRuns: Pick<ActiveRunStore, 'getRun'>;
  workspaceChanges: Pick<WorkspaceChangeService, 'finalizeChangeSet'>;
}): void {
  if (!isTerminalRunEvent(input.event) || !input.event.runId) {
    return;
  }

  const run = input.activeRuns.getRun(input.event.runId);
  if (!run) {
    return;
  }

  input.workspaceChanges.finalizeChangeSet({
    workspace_id: run.workspace_id,
    session_id: run.session_id,
    run_id: run.run_id,
    finalized_at: input.event.createdAt,
  });
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

function isTerminalRunEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'run.completed' ||
    event.eventType === 'run.failed' ||
    event.eventType === 'run.cancelled';
}


function createInMemoryPlanArtifactRepository() {
  const plans = new Map<string, ImplementationPlanArtifactRecord>();
  return {
    saveImplementationPlan(plan: ImplementationPlanArtifactRecord): ImplementationPlanArtifactRecord {
      plans.set(plan.planArtifactId, plan);
      return plan;
    },
    getImplementationPlanByProducingRun(runId: string): ImplementationPlanArtifactRecord | undefined {
      return [...plans.values()].find((plan) => plan.producingRunId === runId);
    },
    updateImplementationPlanStatus(input: { planArtifactId: string; status: ImplementationPlanArtifactRecord['status']; updatedAt: string }): ImplementationPlanArtifactRecord | undefined {
      const current = plans.get(input.planArtifactId);
      if (!current) {
        return undefined;
      }
      const updated = {
        ...current,
        status: input.status,
        updatedAt: input.updatedAt,
      };
      plans.set(updated.planArtifactId, updated);
      return updated;
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
    && 'getResolvedSettings' in value
    && 'getWebSearchSettings' in value
    && 'resolveWebSearchRuntimeConfig' in value,
  );
}
