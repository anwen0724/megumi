/*
 * Composes the Coding Agent product runtime and wraps it for host interfaces.
 * Runtime composition wires module services; host composition adapts those
 * services to UI/CLI/web-facing DTOs.
 */
import { ArtifactContentStore } from '../artifacts/artifact-content-store';
import { ArtifactService, PlanArtifactCompatibilityService, PlanArtifactService } from '../artifacts';
import {
  createAgentRunService,
  createAgentRunTraceFileLogger,
  createModelCallService,
  type AgentRun,
  type AgentRunService,
  type ModelCallService,
} from '../agent-run';
import { createAgentRunRepository } from '../agent-run/repositories/agent-run-repository';
import { createCommandService, type CommandService } from '../commands';
import { createInputService, type InputService } from '../input';
import { createSessionService, type SessionService } from '../session';
import { SessionRepository as SessionV2Repository } from '../session/repositories/session-repository';
import {
  createCodingAgentHostInterface,
  createApprovalController,
  createChatController,
  createSettingsController,
  createWorkspaceController,
  type CodingAgentHostInterface,
  type ChatControllerCompatibilityQueries,
  type DirectoryPickerPort,
  type SessionBranchControllerServicePort,
} from '../host-interface';
import { createArtifactController } from '../host-interface/artifacts/artifact-controller';
import { createPlanController } from '../host-interface/artifacts/plan-controller';
import type { RuntimeLogger } from '../host-interface/runtime-logger';
import type { ChatStreamEvent } from '../projections/chat-stream';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import {
  composeCodingAgentToolExecutionService,
  composeCodingAgentToolRegistryService,
} from './compose-coding-agent-tool-runtime';
import { composeCodingAgentContext } from './compose-coding-agent-context';
import {
  createSettingsService,
  type MemorySettingsPort,
  type SettingsFileStore,
  type SettingsService,
} from '../settings';
import {
  createWorkspaceChangeService,
  createWorkspacePathPolicyService,
  createWorkspaceService,
  type WorkspaceChangeService,
  type WorkspacePathPolicyService,
  type WorkspaceService,
} from '../workspace';
import { createPermissionService, type PermissionService } from '../permissions';
import { createLocalSettingsJsonStorage } from '../adapters/local/settings/settings-json-storage';
import {
  createLocalProjectFileSystem,
  type LocalWorkspaceServiceFileSystem,
} from '../adapters/local/workspace/project-file-system';
import {
  createAiClient,
  createAnthropicProtocolAdapter,
  createOpenAICompatibleProtocolAdapter,
  ProtocolRegistry,
  AssistantEventStream,
  type AiClient,
  type AiCallRequest,
  type AssistantMessage,
  type AssistantStreamEvent,
} from '@megumi/ai';
import type { RuntimeEvent } from '../events';
import type { TimelineMessage } from '../projections/timeline';
import { WorkspaceChangeRepository } from '../workspace/repositories/workspace-change-repository';
import { WorkspaceRepository } from '../workspace/repositories/workspace-repository';

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

export interface CodingAgentHomePaths {
  homePath: string;
  sqlitePath: string;
  settingsPath: string;
}

export interface ComposeCodingAgentRuntimeOptions {
  homePaths: CodingAgentHomePaths;
  migrationsFolder?: string;
  runtimeLogger: RuntimeLogger;
  aiClient?: AiClient;
  modelCallProviderService?: LegacyModelCallProviderForTests;
  summaryModelCallPort?: Parameters<typeof composeCodingAgentContext>[0]['summaryModelCallPort'];
  appSettingsProvider?: unknown;
  memorySettingsProvider?: MemorySettingsPort;
  chatStreamEventSink?: { publish(event: ChatStreamEvent): void };
  workspaceChangeFooterProjector?: unknown;
  directoryPicker?: DirectoryPickerPort;
  projectFileSystem?: LocalWorkspaceServiceFileSystem;
  settingsStorage?: SettingsFileStore;
}

export interface CodingAgentRuntime {
  agentRunService: AgentRunService;
  modelCallService: ModelCallService;
  inputService: InputService;
  commandService: CommandService;
  sessionService: SessionService;
  settingsService: SettingsService;
  workspaceService: WorkspaceService;
  workspaceChangeService: WorkspaceChangeService;
  workspacePathPolicyService: WorkspacePathPolicyService;
  permissionService: PermissionService;
  artifactService: ArtifactService;
  planArtifactService: PlanArtifactService;
  contextRuntime: ReturnType<typeof composeCodingAgentContext>;
  sessionBranchService: SessionBranchControllerServicePort;
  compatibility: ChatControllerCompatibilityQueries & {
    listWorkspaceIds(): string[];
    listTimelineMessagesBySession(payload: Parameters<ChatControllerCompatibilityQueries['listTimelineMessagesBySession']>[0]): ReturnType<ChatControllerCompatibilityQueries['listTimelineMessagesBySession']>;
    listRunsBySession(sessionId: string): AgentRun[];
  };
  dispose(): void;
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

export function composeCodingAgentRuntime(options: ComposeCodingAgentRuntimeOptions): CodingAgentRuntime {
  const persistence = composeCodingAgentPersistence({
    sqlitePath: options.homePaths.sqlitePath,
    migrationsFolder: options.migrationsFolder,
  });
  const workspaceRepository = new WorkspaceRepository(persistence.database);
  const workspaceChangeRepository = new WorkspaceChangeRepository(persistence.database);
  const sessionRepository = new SessionV2Repository(persistence.database);
  const agentRunRepository = createAgentRunRepository({ database: persistence.database });
  const sessionService = createSessionService({ repository: sessionRepository });
  const inputService = createInputService();
  const commandService = createCommandService();
  const toolRegistry = composeCodingAgentToolRegistryService();
  const settingsService = resolveSettingsService(options.appSettingsProvider) ?? createSettingsService({
    file_store: options.settingsStorage ?? createLocalSettingsJsonStorage({
      settingsPath: options.homePaths.settingsPath,
    }),
    env: process.env,
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
  const workspaceChangeService = createWorkspaceChangeService({
    repository: workspaceChangeRepository,
    path_policy: workspacePathPolicyService,
    file_system: workspaceFileSystem,
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
  const agentRunTraceLogger = createAgentRunTraceFileLogger({
    log_file_path: `${options.homePaths.homePath}/logs/agent-run-trace.jsonl`,
    on_error: (error) => options.runtimeLogger.warn('agent_run_trace.write_failed', {
      error: error instanceof Error ? error.message : String(error),
    }),
  });
  const modelCallService = createModelCallService({
    ai_client: options.aiClient
      ?? (options.modelCallProviderService ? aiClientFromLegacyProvider(options.modelCallProviderService) : undefined)
      ?? createAiClientForConfiguredProviders(settingsService),
  });
  const contextRuntime = composeCodingAgentContext({
    sessionService,
    runtimeEventRepository: { listRuntimeEventsByRun: () => [] },
    summaryModelCallPort: options.summaryModelCallPort ?? createContextSummaryModelCallPort({
      modelCallService,
      settingsService,
    }),
    modelConfigProvider: () => ({
      model_id: 'configured-model',
      context_window_tokens: 8192,
    }),
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
    database: persistence.database,
    input_service: inputService,
    command_service: commandService,
    command_execution_context_provider: ({ request, session_id }) => ({
      session_id,
      workspace_id: request.workspace_id,
      services: {
        context_compaction: contextRuntime.contextCompactionService,
      },
    }),
    session_service: sessionService,
    settings_service: agentRunSettingsService,
    context_service: contextRuntime.contextService,
    model_call_service: modelCallService,
    tool_registry_service: toolRegistry,
    tool_execution_service_factory: ({ run_id, session_id, workspace_id, workspace_root }) => {
      const toolExecutionService = composeCodingAgentToolExecutionService({
        projectRoot: workspace_root ?? process.cwd(),
        registryService: toolRegistry,
        workspacePathPolicyService,
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
    workspace_service: workspaceService,
    workspace_path_policy_service: workspacePathPolicyService,
    context_usage_signal_bus: contextRuntime.contextUsageSignalBus,
    context_usage_monitor: contextRuntime.contextUsageMonitor,
    context_compaction_service: contextRuntime.contextCompactionService,
    event_publisher: options.chatStreamEventSink
      ? {
          publish(event) {
            const chatEvent = toChatStreamEvent(event);
            if (chatEvent) {
              options.chatStreamEventSink?.publish(chatEvent);
            }
          },
        }
      : undefined,
  });

  return {
    agentRunService,
    modelCallService,
    inputService,
    commandService,
    sessionService,
    settingsService,
    workspaceService,
    workspaceChangeService,
    workspacePathPolicyService,
    permissionService,
    artifactService,
    planArtifactService,
    contextRuntime,
    sessionBranchService: createUnsupportedSessionBranchService(),
    compatibility: {
      listWorkspaceIds: () => workspaceRepository.listWorkspaces().map((workspace) => workspace.workspace_id),
      listTimelineMessagesBySession: (payload) => listSessionTimelineMessages(sessionService, payload),
      listRunsBySession: (sessionId) => agentRunRepository.listRunsBySession(sessionId),
      listRuntimeEventsByRun: () => [],
    },
    dispose: () => persistence.database.close(),
  };
}

export function composeCodingAgentHostInterface(
  options: ComposeCodingAgentRuntimeOptions,
): CodingAgentHostInterface {
  const runtime = composeCodingAgentRuntime(options);
  const artifacts = createArtifactController(runtime.artifactService);

  return createCodingAgentHostInterface({
    chat: createChatController({
      agentRunService: runtime.agentRunService,
      commandService: runtime.commandService,
      sessionService: runtime.sessionService,
      branchService: runtime.sessionBranchService,
      compatibility: runtime.compatibility,
    }),
    workspace: createWorkspaceController({
      workspaceService: runtime.workspaceService,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
    }),
    settings: createSettingsController(runtime.settingsService),
    approval: createApprovalController(runtime.agentRunService),
    artifacts: {
      ...artifacts,
      plan: createPlanController(runtime.planArtifactService),
    },
    dispose: runtime.dispose,
  });
}

function createAiClientForConfiguredProviders(settingsService: SettingsService): AiClient {
  return createAiClient({
    registry: new ProtocolRegistry([
      createOpenAICompatibleProtocolAdapter({ fetch }),
      createAnthropicProtocolAdapter({ fetch }),
    ]),
  });
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
      if (!provider || !provider.enabled || !provider.models.includes(request.model_id)) {
        return result;
      }
      return {
        status: 'ok',
        config: {
          provider_id: request.provider_id,
          protocol: provider.protocol,
          ...(provider.base_url ? { base_url: provider.base_url } : {}),
          model_id: request.model_id,
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

function createContextSummaryModelCallPort(input: {
  modelCallService: ModelCallService;
  settingsService: Pick<SettingsService, 'listAvailableModels' | 'resolveProviderRuntimeConfig'>;
}): Parameters<typeof composeCodingAgentContext>[0]['summaryModelCallPort'] {
  return {
    async completePrompt(request) {
      const selected = input.settingsService.listAvailableModels();
      if (selected.status === 'failed') {
        return { status: 'failed', failure: selected.failure };
      }
      const model = selected.models[0];
      if (!model) {
        return {
          status: 'failed',
          failure: {
            code: 'context_compaction_model_unavailable',
            message: 'No enabled model is available for context compaction.',
          },
        };
      }
      const config = input.settingsService.resolveProviderRuntimeConfig({
        provider_id: model.provider_id,
        model_id: model.model_id,
      });
      if (config.status === 'failed') {
        return { status: 'failed', failure: config.failure };
      }

      const result = await input.modelCallService.modelCall({
        owner: {
          type: 'context_compaction',
          session_id: request.session_id,
        },
        prompt: request.prompt,
        model_config: config.config,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: result.failure };
      }

      const deltas: string[] = [];
      for await (const event of result.events) {
        if (event.type === 'text_delta') {
          deltas.push(event.delta);
        }
        if (event.type === 'completed') {
          return {
            status: 'ok',
            text: event.content || deltas.join(''),
            metadata: {
              model_call_id: event.model_call_id,
              provider_id: model.provider_id,
              model_id: model.model_id,
            },
          };
        }
        if (event.type === 'failed') {
          return { status: 'failed', failure: event.failure };
        }
      }

      return {
        status: 'ok',
        text: deltas.join(''),
        metadata: {
          provider_id: model.provider_id,
          model_id: model.model_id,
        },
      };
    },
  };
}

function toChatStreamEvent(event: {
  event_id: string;
  type: string;
  run_id?: string;
  session_id?: string;
  created_at: string;
  payload?: Record<string, unknown>;
}): ChatStreamEvent | undefined {
  if (event.type !== 'run.completed' || !event.run_id) {
    return undefined;
  }
  const workspaceId = stringPayloadFromRecord(event.payload, 'workspace_id') ?? 'unknown-workspace';
  const sessionId = event.session_id ?? stringPayloadFromRecord(event.payload, 'session_id') ?? 'unknown-session';
  return {
    eventId: `chat-stream:${event.event_id}`,
    eventType: 'turn.completed',
    projectId: workspaceId,
    sessionId,
    runId: event.run_id,
    streamId: event.run_id,
    streamKind: 'main',
    seq: 0,
    createdAt: event.created_at,
  };
}

function stringPayloadFromRecord(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key];
  return typeof value === 'string' ? value : undefined;
}

function listSessionTimelineMessages(
  sessionService: SessionService,
  payload: Parameters<CodingAgentRuntime['compatibility']['listTimelineMessagesBySession']>[0],
): ReturnType<CodingAgentRuntime['compatibility']['listTimelineMessagesBySession']> {
  const result = sessionService.listMessages({
    session_id: payload.sessionId,
    active_path_only: true,
  });
  if (result.status === 'failed') {
    return { messages: [], diagnostics: [] };
  }

  return {
    messages: result.messages.map((item): TimelineMessage => {
      const message = item.message;
      const createdAt = message.created_at;
      if (message.role === 'assistant') {
        const runId = message.run_id ?? `run:${message.message_id}`;
        return {
          messageId: message.message_id,
          role: 'assistant',
          projectId: payload.projectId,
          sessionId: message.session_id,
          runId,
          createdAt,
          ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
          blocks: [{
            blockId: `answer:${message.message_id}`,
            kind: 'answer_text',
            runId,
            textId: `text:${message.message_id}`,
            status: 'completed',
            text: message.content_text,
            format: 'markdown',
            createdAt,
            ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
          }],
        };
      }

      return {
        messageId: message.message_id,
        role: 'user',
        projectId: payload.projectId,
        sessionId: message.session_id,
        ...(message.run_id ? { runId: message.run_id } : {}),
        createdAt,
        ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
        blocks: [{
          blockId: `user-text:${message.message_id}`,
          kind: 'user_text',
          text: message.content_text,
          format: 'plain',
          createdAt,
          ...(message.completed_at ? { updatedAt: message.completed_at } : {}),
        }],
      };
    }),
    diagnostics: [],
  };
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
    && 'getResolvedSettings' in value,
  );
}

function createUnsupportedSessionBranchService(): SessionBranchControllerServicePort {
  return {
    createBranchDraft() {
      throw new Error('Session branch drafts are not available during the Agent Run transition.');
    },
    cancelBranchDraft() {
      return { cancelled: false, reason: 'branch_marker_not_found' as const, events: [] };
    },
  };
}
