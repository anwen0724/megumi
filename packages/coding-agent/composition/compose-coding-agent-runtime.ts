/*
 * Composes the Coding Agent product runtime and wraps it for host interfaces.
 * Runtime composition wires module services; host composition adapts those
 * services to UI/CLI/web-facing DTOs.
 */
import { ArtifactContentStore } from '../artifacts/artifact-content-store';
import { ArtifactService, PlanArtifactCompatibilityService, PlanArtifactService } from '../artifacts';
import {
  createAgentRunService,
  createModelCallService,
  type AgentRunService,
  type ModelCallService,
} from '../agent-run';
import { createCommandService, type CommandService } from '../commands';
import { createInputService, type InputService } from '../input';
import { createSessionService, type SessionService } from '../session';
import { SessionRepository as SessionV2Repository } from '../session/repositories/session-repository';
import {
  createCodingAgentHostInterface,
  createInputController,
  mapAgentRunEvents,
  type CodingAgentHostInterface,
} from '../host-interface';
import { createArtifactController } from '../host-interface/artifacts/artifact-controller';
import { createPlanController } from '../host-interface/artifacts/plan-controller';
import { createApprovalController } from '../host-interface/permissions/approval-controller';
import type { ApprovalResolutionPort } from '../host-interface/permissions/approval-resolution-service';
import { createProviderController } from '../host-interface/settings/provider-controller';
import { createSettingsController } from '../host-interface/settings/settings-controller';
import {
  createSessionBranchController,
  type SessionBranchControllerServicePort,
} from '../host-interface/session/branch-controller';
import { createSessionController } from '../host-interface/session/session-controller';
import { createWorkspaceController } from '../host-interface/workspace/workspace-controller';
import type { DirectoryPickerPort } from '../host-interface/workspace/workspace-controller';
import type { RuntimeLogger } from '../host-interface/runtime-logger';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import { composeCodingAgentPersistence } from './compose-coding-agent-persistence';
import {
  composeCodingAgentToolExecutionService,
  composeCodingAgentToolRegistryService,
} from './compose-coding-agent-tool-runtime';
import { composeCodingAgentContext } from './compose-coding-agent-context';
import type { CodingAgentHomePaths } from './compose-coding-agent-session-runtime';
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
  createAnthropicProviderAdapter,
  createDeepSeekProviderAdapter,
  createOpenAICompatibleProviderAdapter,
  createOpenAIProviderAdapter,
  ProviderRegistry,
  AssistantEventStream,
  type AiClient,
  type AiCallRequest,
  type AssistantMessage,
  type AssistantStreamEvent,
} from '@megumi/ai';
import type { RuntimeEvent } from '@megumi/shared/runtime';

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
  compatibility: {
    listWorkspaceIds(): string[];
    listTimelineMessagesBySession(payload: Parameters<ReturnType<typeof createSessionController>['listTimeline']>[0]): ReturnType<ReturnType<typeof createSessionController>['listTimeline']>;
    listRunsBySession(sessionId: string): ReturnType<ReturnType<typeof createSessionController>['listRuns']>['runs'];
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
  const sessionRepository = new SessionV2Repository(persistence.database);
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
    repository: persistence.workspaceRepository,
    file_system: workspaceFileSystem,
  });
  const workspaceChangeService = createWorkspaceChangeService({
    repository: persistence.workspaceChangeRepository,
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
  const modelCallService = createModelCallService({
    ai_client: options.aiClient
      ?? (options.modelCallProviderService ? aiClientFromLegacyProvider(options.modelCallProviderService) : undefined)
      ?? createAiClientForConfiguredProviders(settingsService),
  });
  const contextRuntime = composeCodingAgentContext({
    sessionService,
    runtimeEventRepository: persistence.agentLoopRepository as never,
    summaryModelCallPort: options.summaryModelCallPort ?? createUnavailableSummaryModelCallPort(),
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
    repository: persistence.agentLoopRepository,
    planArtifactCompatibility,
  });
  const agentRunService = createAgentRunService({
    repository: persistence.agentRunRepository,
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
    workspace_service: workspaceService,
    workspace_path_policy_service: workspacePathPolicyService,
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
      listWorkspaceIds: () => persistence.workspaceRepository.listWorkspaces().map((workspace) => workspace.workspace_id),
      listTimelineMessagesBySession: (payload) => persistence.agentLoopRepository.listCommittedMessagesBySession(payload),
      listRunsBySession: (sessionId) => persistence.agentLoopRepository.listRunsBySession(sessionId),
    },
    dispose: () => persistence.database.close(),
  };
}

export function composeCodingAgentHostInterface(
  options: ComposeCodingAgentRuntimeOptions,
): CodingAgentHostInterface {
  const runtime = composeCodingAgentRuntime(options);
  const settings = createSettingsController(runtime.settingsService);
  const artifacts = createArtifactController(runtime.artifactService);

  return createCodingAgentHostInterface({
    input: createInputController({
      agentRunService: runtime.agentRunService,
      sessionLookup: {
        getSession(sessionId) {
          const result = runtime.sessionService.getSession({ session_id: sessionId });
          if (result.status !== 'found') return undefined;
          return {
            sessionId: result.session.session_id,
            title: result.session.title,
            workspaceId: result.session.workspace_id,
            status: result.session.status,
            createdAt: result.session.created_at,
            updatedAt: result.session.updated_at,
          };
        },
      },
    }),
    commands: runtime.commandService,
    workspace: createWorkspaceController({
      workspaceService: runtime.workspaceService,
      ...(options.directoryPicker ? { directoryPicker: options.directoryPicker } : {}),
    }),
    session: {
      ...createSessionController(runtime.sessionService, runtime.compatibility),
      ...createSessionBranchController(runtime.sessionBranchService),
    },
    settings: {
      ...settings,
      provider: createProviderController(runtime.settingsService),
    },
    permissions: createApprovalController(createAgentRunApprovalResolutionPort(runtime.agentRunService)),
    artifacts: {
      ...artifacts,
      plan: createPlanController(runtime.planArtifactService),
    },
    dispose: runtime.dispose,
  });
}

function createAiClientForConfiguredProviders(settingsService: SettingsService): AiClient {
  const providerIds = settingsService.listProviderSettings();
  const adapters = providerIds.status === 'ok'
    ? providerIds.providers.flatMap((provider) => provider.enabled ? [createProviderAdapter(provider.provider_id, provider.base_url)] : [])
    : [];

  return createAiClient({
    registry: new ProviderRegistry(adapters),
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
          kind: provider.kind,
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

function createProviderAdapter(providerId: string, baseUrl: string | undefined) {
  if (providerId === 'openai') {
    return createOpenAIProviderAdapter({
      baseUrl: baseUrl ?? 'https://api.openai.com/v1',
      fetch,
    });
  }
  if (providerId === 'deepseek') {
    return createDeepSeekProviderAdapter({
      baseUrl: baseUrl ?? 'https://api.deepseek.com',
      fetch,
    });
  }
  if (providerId === 'anthropic') {
    return createAnthropicProviderAdapter({
      ...(baseUrl ? { baseUrl } : {}),
      fetch,
    });
  }
  return createOpenAICompatibleProviderAdapter({
    providerId,
    baseUrl: baseUrl ?? 'http://localhost',
    fetch,
  });
}

function createUnavailableSummaryModelCallPort(): Parameters<typeof composeCodingAgentContext>[0]['summaryModelCallPort'] {
  return {
    async completePrompt() {
      return {
        status: 'failed',
        failure: {
          code: 'context_compaction_model_unconfigured',
          message: 'Context compaction summary model call is not configured.',
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

function createAgentRunApprovalResolutionPort(agentRunService: AgentRunService): ApprovalResolutionPort {
  return {
    resolve(payload) {
      const events = resumeApproval(agentRunService, payload);
      return {
        data: {
          approval: {
            approvalRecordId: `approval-record:${crypto.randomUUID()}`,
            approvalRequestId: payload.approvalRequestId,
            toolCallId: 'unknown',
            toolExecutionId: 'unknown',
            runId: 'unknown',
            stepId: 'unknown',
            decision: payload.decision,
            scope: payload.scope,
            decidedBy: 'user',
            ...(payload.reason ? { reason: payload.reason } : {}),
            decidedAt: payload.decidedAt,
          },
        },
        events,
      };
    },
  };
}

async function* resumeApproval(
  agentRunService: AgentRunService,
  payload: Parameters<ApprovalResolutionPort['resolve']>[0],
): AsyncIterable<RuntimeEvent> {
  const result = await agentRunService.resumeRunAfterApproval({
    approval_request_id: payload.approvalRequestId,
    decision: {
      approval_request_id: payload.approvalRequestId,
      decision: payload.decision,
      scope: payload.scope,
      decided_by: 'user',
      decided_at: payload.decidedAt,
      ...(payload.reason ? { reason: payload.reason } : {}),
    },
  });
  if (result.status === 'resumed') {
    for await (const event of mapAgentRunEvents(result.events, payload.approvalRequestId)) {
      yield event;
    }
  }
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
