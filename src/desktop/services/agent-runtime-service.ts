// Coordinates renderer run/control requests with the owner-module Agent Runner for the desktop host.
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
} from '../../app';
import type { AiRequestOptions, Model } from '../../ai';
import { type AgentAiClient, type AgentRunEvent, createAgentRunner, parseApprovalWaitStateFromRunMetadata } from '../../agent';
import { BUILT_IN_INPUT_COMMAND_REGISTRY } from '../../command';
import type {
  SqliteRecoveryRepository,
  SqliteRuntimeEventRepository,
  SqliteSessionStateRepository,
} from '../../database';
import { parseRawInput, type ParsedInput, type RawInput } from '../../input';
import type { evaluatePermissionPolicy, PermissionRepository } from '../../permission';
import type { JsonObject, JsonValue } from '../../shared';
import { createSessionStateManager, type Session } from '../../session';
import { createBuiltInToolRegistry, createToolExecutionService, projectToolSetFromRegistry } from '../../tools';
import { unavailable } from '../ipc/ipc-errors';
import type { AppSettingsStore } from '../infrastructure/app-settings-store';
import type { ProviderSettingsStore } from '../infrastructure/provider-settings-store';
import type { RuntimeEventBus } from '../composition/create-runtime-event-bus';
import {
  isInputSourceKind,
  isProviderId,
  jsonObjectOrUndefined,
  numberOption,
  permissionModeOption,
  resumeDecisionKind,
  stringMetadata,
  titleFromInput,
} from '../composition/runtime-id';
import type { TimelineHistoryCommitService } from './timeline-history-commit-service';

export interface DesktopAgentRuntimeService {
  agentRuntime: AgentRuntimePort;
  dispose(): void;
}

export function createDesktopAgentRuntimeService(options: {
  eventBus: RuntimeEventBus;
  sessionRepository: SqliteSessionStateRepository;
  sessionManager: ReturnType<typeof createSessionStateManager>;
  permissionRepository: PermissionRepository;
  permissionEvaluator: { evaluate: typeof evaluatePermissionPolicy };
  toolRegistry: ReturnType<typeof createBuiltInToolRegistry>;
  toolExecutionService: ReturnType<typeof createToolExecutionService>;
  runtimeEventRepository: SqliteRuntimeEventRepository;
  recoveryRepository: SqliteRecoveryRepository;
  timelineHistoryCommitService: TimelineHistoryCommitService;
  settingsStore: AppSettingsStore;
  providerSettingsStore: ProviderSettingsStore;
  ai: AgentAiClient;
  model: Model;
  aiOptions: AiRequestOptions;
  systemInstruction: string;
  now: () => string;
  createId: (prefix: string, value: string) => string;
}): DesktopAgentRuntimeService {
  const parseByRunId = new Map<string, ParsedInput>();
  const activeRunsByRequestId = new Map<string, { runId: string; sessionId: string; workspaceId?: string; controller: AbortController }>();
  const activeRunsByRunId = new Map<string, { requestId: string; sessionId: string; workspaceId?: string; controller: AbortController }>();

  const runner = createAgentRunner({
    sessionManager: options.sessionManager,
    sessionRepository: options.sessionRepository,
    permissionRepository: options.permissionRepository,
    permissionEvaluator: options.permissionEvaluator,
    toolRegistry: options.toolRegistry,
    toolSet: projectToolSetFromRegistry(options.toolRegistry).tools,
    toolExecutor: options.toolExecutionService,
    ai: options.ai,
    model: options.model,
    aiOptions: options.aiOptions,
    systemInstruction: options.systemInstruction,
    now: options.now,
    createId: options.createId,
    emit: (event) => publishRuntimeEvent(mapAgentRunEventToRuntimeEvent(event)),
  });

  const agentRuntime: AgentRuntimePort = {
    async startRun(request) {
      const session = ensureSession({ request, sessionRepository: options.sessionRepository, sessionManager: options.sessionManager, now: options.now });
      const parsedInput = parseRuntimeInput(request, options.now, options.createId);
      const runId = options.createId('session-run', `run-${String(parsedInput.id)}`);
      const controller = new AbortController();
      const active = { runId, sessionId: session.id, workspaceId: request.workspaceId, controller };
      activeRunsByRequestId.set(request.client.requestId, active);
      activeRunsByRunId.set(runId, { requestId: request.client.requestId, sessionId: session.id, workspaceId: request.workspaceId, controller });
      try {
        const result = await runner.startRun({
          parsedInput,
          sessionId: session.id,
          workspaceId: request.workspaceId,
          model: modelFromRequest(request, options.providerSettingsStore, options.settingsStore),
          signal: controller.signal,
          options: {
            maxTurns: numberOption(request.metadata?.maxTurns, 4),
            maxToolCalls: numberOption(request.metadata?.maxToolCalls, 8),
            permissionMode: permissionModeOption(request.permissionMode),
          },
        });
        if (result.kind === 'not_agent_run') {
          clearActiveRun({ runId, requestId: request.client.requestId });
          return {
            runId: result.parsedInputId,
            sessionId: session.id,
            workspaceId: request.workspaceId,
            status: 'completed',
            metadata: { reason: result.reason },
          };
        }
        parseByRunId.set(result.result.run.id, parsedInput);
        const response = mapAgentResultToAppResponse(result.result);
        if (response.status !== 'running' && response.status !== 'waiting_for_approval') {
          clearActiveRun({ runId: response.runId, requestId: request.client.requestId });
        }
        return response;
      } catch (error) {
        clearActiveRun({ runId, requestId: request.client.requestId });
        throw error;
      }
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
          decidedAt: options.now(),
        },
        options: {
          maxTurns: numberOption(request.metadata?.maxTurns, 4),
          maxToolCalls: numberOption(request.metadata?.maxToolCalls, 8),
          permissionMode: permissionModeOption(request.metadata?.permissionMode),
        },
      });
      const response = mapAgentResultToAppResponse(result);
      if (response.status !== 'running' && response.status !== 'waiting_for_approval') {
        clearActiveRun({ runId: response.runId });
      }
      return response;
    },
    async cancelRun(request: AgentRuntimeCancelRequest): Promise<AppRunControlResponse> {
      const targetRequestId = typeof request.metadata?.targetRequestId === 'string' ? request.metadata.targetRequestId : undefined;
      const activeByRun = request.runId ? activeRunsByRunId.get(request.runId) : undefined;
      const activeByRequest = targetRequestId ? activeRunsByRequestId.get(targetRequestId) : undefined;
      const activeRunId = request.runId || activeByRequest?.runId;
      if (!activeRunId) throw unavailable('run.cancel', 'runId or targetRequestId is required');
      const run = options.sessionRepository.getRunRecord(activeRunId);
      if (!run) throw unavailable('run.cancel', `run record was not found: ${activeRunId}`);
      const active = activeByRun ?? activeByRequest;
      const cancelledAt = options.now();
      active?.controller.abort();
      if (run.status === 'waiting_for_approval') {
        const waiting = parseApprovalWaitStateFromRunMetadata(run.metadata);
        if (waiting) {
          await options.permissionRepository.resolveApprovalRequest(waiting.approvalRequestId, {
            kind: 'cancel',
            decidedAt: cancelledAt,
          });
        }
      }
      options.recoveryRepository.saveCancelRequest({
        cancelRequestId: options.createId('cancel-request', `${activeRunId}-${cancelledAt}`),
        runId: activeRunId,
        sessionId: request.sessionId ?? run.sessionId,
        workspaceId: request.workspaceId ?? active?.workspaceId,
        reason: request.reason ?? 'user_requested',
        createdAt: cancelledAt,
        metadata: jsonObjectOrUndefined({ ...(request.metadata ?? {}), ...(targetRequestId ? { targetRequestId } : {}) }),
      });
      publishRuntimeEvent({
        type: 'run.cancel.requested',
        runId: activeRunId,
        sessionId: request.sessionId ?? run.sessionId,
        workspaceId: request.workspaceId ?? active?.workspaceId,
        occurredAt: cancelledAt,
        payload: { reason: request.reason ?? 'user_requested', ...(targetRequestId ? { targetRequestId } : {}) },
      });
      const cancelled = options.sessionManager.updateRunStatus({
        runId: activeRunId,
        status: 'cancelled',
        endedAt: cancelledAt,
        metadata: { ...(run.metadata ?? {}), cancelledBy: 'desktop' },
      });
      publishRuntimeEvent({
        type: 'run.cancelled',
        runId: activeRunId,
        sessionId: cancelled.sessionId,
        workspaceId: request.workspaceId ?? active?.workspaceId,
        occurredAt: cancelledAt,
        payload: { reason: request.reason ?? 'user_requested' },
      });
      clearActiveRun({ runId: activeRunId, requestId: targetRequestId ?? activeByRun?.requestId });
      return {
        runId: cancelled.id,
        sessionId: cancelled.sessionId,
        workspaceId: request.workspaceId ?? active?.workspaceId,
        status: 'cancelled',
      };
    },
    async retryRun(request: AgentRuntimeRetryRequest): Promise<AppRunControlResponse> {
      if (!request.runId) throw unavailable('run.retry', 'runId is required');
      const run = options.sessionRepository.getRunRecord(request.runId);
      if (!run) throw unavailable('run.retry', `run record was not found: ${request.runId}`);
      const sessionId = request.sessionId ?? run.sessionId;
      const retryKind = request.metadata?.retryKind === 'manual_retry' ? 'manual_retry' : 'manual_rerun';
      options.recoveryRepository.saveRetryRequest({
        retryRequestId: options.createId('retry-request', `${request.runId}-${options.now()}`),
        runId: request.runId,
        sessionId,
        workspaceId: request.workspaceId,
        retryKind,
        reason: request.reason ?? run.status,
        createdAt: options.now(),
        metadata: jsonObjectOrUndefined(request.metadata),
      });
      options.sessionManager.recordRerun({
        idSeed: `rerun-${request.runId}-${options.now()}`,
        sourceEntryIdSeed: `source-rerun-${request.runId}-${options.now()}`,
        sessionId,
        targetRunId: request.runId,
        attemptNumber: options.sessionRepository.listRetryAttempts(sessionId).length + 1,
        metadata: { retryKind, sourceRunId: request.runId },
      });
      publishRuntimeEvent({
        type: 'run.retry.requested',
        runId: request.runId,
        sessionId,
        workspaceId: request.workspaceId,
        occurredAt: options.now(),
        payload: { retryKind, reason: request.reason ?? run.status },
      });
      const parsedInput = {
        id: options.createId('parsed-input', `retry-${request.runId}-${options.now()}`),
        rawInputId: options.createId('raw-input', `retry-${request.runId}-${options.now()}`),
        source: { kind: 'desktop' as const },
        rawKind: 'text' as const,
        kind: 'user_input' as const,
        text: run.inputSummary,
        attachments: [],
        references: [],
        facts: [],
        createdAt: options.now(),
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
      return options.eventBus.subscribe(callback);
    },
  };

  return {
    agentRuntime,
    dispose() {
      parseByRunId.clear();
      activeRunsByRequestId.clear();
      activeRunsByRunId.clear();
    },
  };

  function publishRuntimeEvent(event: AgentRuntimeEvent): void {
    const enriched = enrichRuntimeEvent(event);
    options.runtimeEventRepository.saveEvent(enriched);
    options.timelineHistoryCommitService.handle(enriched);
    options.eventBus.publish(enriched);
  }

  function enrichRuntimeEvent(event: AgentRuntimeEvent): AgentRuntimeEvent {
    const payloadSessionId = typeof event.payload?.sessionId === 'string' ? event.payload.sessionId : undefined;
    const payloadWorkspaceId = typeof event.payload?.workspaceId === 'string' ? event.payload.workspaceId : undefined;
    const run = event.runId ? options.sessionRepository.getRunRecord(event.runId) : undefined;
    const sessionId = event.sessionId ?? payloadSessionId ?? run?.sessionId;
    const session = sessionId ? options.sessionRepository.getSession(sessionId) : undefined;
    const metadataWorkspaceId = typeof run?.metadata?.workspaceId === 'string' ? run.metadata.workspaceId : undefined;
    const workspaceId = event.workspaceId ?? payloadWorkspaceId ?? metadataWorkspaceId ?? session?.workspaceId;
    const activeRequestId = event.runId ? activeRunsByRunId.get(event.runId)?.requestId : undefined;
    const metadataRequestId = typeof run?.metadata?.requestId === 'string' ? run.metadata.requestId : undefined;
    const payloadRequestId = typeof event.payload?.requestId === 'string' ? event.payload.requestId : undefined;
    const requestId = payloadRequestId ?? activeRequestId ?? metadataRequestId;

    return {
      ...event,
      ...(sessionId ? { sessionId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(requestId ? { payload: { ...(event.payload ?? {}), requestId } } : {}),
    };
  }

  function clearActiveRun(input: { runId?: string; requestId?: string }): void {
    const requestId = input.requestId ?? (input.runId ? activeRunsByRunId.get(input.runId)?.requestId : undefined);
    const runId = input.runId ?? (requestId ? activeRunsByRequestId.get(requestId)?.runId : undefined);
    if (requestId) activeRunsByRequestId.delete(requestId);
    if (runId) activeRunsByRunId.delete(runId);
  }

  function getParsedInputForRun(runId: string, sessionId?: string, workspaceId?: string): ParsedInput & { sessionId?: string } {
    const existing = parseByRunId.get(runId);
    if (existing) return { ...existing, sessionId };
    const run = options.sessionRepository.getRunRecord(runId);
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
  sessionRepository: SqliteSessionStateRepository;
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
