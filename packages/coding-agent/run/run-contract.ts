// Defines the product run service contract consumed by runtime composition and UI shells.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  PlanStatusUpdatePayload,
  RunStartPayload,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
  SessionTimelineListData,
} from '@megumi/shared/ipc';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContextBuildRequest,
  ModelStepRuntimeRequest,
  SessionInstructionSourceSnapshot,
} from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';
import type { PermissionMode } from '@megumi/shared/permission';
import type {
  ImplementationPlanArtifactRecord,
} from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { RunContext, ModelCapabilitySummary } from '@megumi/shared/run';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type {
  Run,
  RunAction,
  RunObservation,
  RunStep,
  Session,
  SessionCompactionEntry,
  SessionMessage,
} from '@megumi/shared/session';
import type { SessionContextInput } from '@megumi/shared/session';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool';
import type { MemoryCaptureSignal } from '@megumi/shared/memory';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '@megumi/shared/workspace';

import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import type { ModelStepRecord } from '../persistence/repos/model-step.repo';
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type {
  PermissionSnapshotService,
} from '../permissions/permission-snapshot-service';
import type { PlanArtifactServicePort } from '../artifacts';
import type {
  BuildModelCallInputFailure,
  BuildModelCallInputInput,
  BuildModelCallInputResult,
  CompactIfNeededInput,
  LoadInstructionSourcesInput,
  ModelInputMemoryRecallSource,
  SessionCompactionOrchestratorRepository,
  SessionCompactionOrchestrationResult,
} from './context';
import type {
  BuildSessionContextInputFromRepositoryInput,
  SessionBranchServicePort,
} from '../session';
import type {
  PendingToolApprovalContinuation,
  ResumeToolApprovalInput,
  ResumeToolApprovalOutcome,
  ToolApprovalResumePort,
  ToolCallRunner,
} from './tool-calls';
import type { ModelCallCompletionResult } from './model-call';
import type { RunHostBoundaryPort, RunIdFactory } from './lifecycle';
import type {
  RunToolRegistrySnapshotBuildInput,
  RunToolRegistrySnapshotBuildResult,
} from '../tools/tool-registry-snapshot';
import type { ChatStreamEventSink } from '../projections/chat-stream';

export interface AgentRunServiceClock {
  now(): string;
}

export interface AgentRunServiceIds extends RunIdFactory {
  compactionId(): string;
  retryAttemptId(): string;
  sessionId(): string;
  sourceEntryId(): string;
  branchMarkerId(): string;
  chatStreamEventId(): string;
  chatStreamId(input: { runId: string }): string;
  chatTextId(): string;
  chatThinkingId(): string;
}

export interface SessionRunContextService {
  createBaselineContext(input: {
    runId: string;
    goal: string;
    workspaceId: string;
    workspacePath: string;
    modelCapabilitySummary: ModelCapabilitySummary;
    contextBudgetPolicy: ContextBudgetPolicy;
  }): RunContext;
}

export interface AgentRunModelStepProvider {
  streamModelCall(request: ModelStepRuntimeRequest): AsyncIterable<RuntimeEvent>;
  completeModelCall(request: ModelStepRuntimeRequest): Promise<ModelCallCompletionResult>;
  cancelModelCall(requestId: string): boolean;
}

export interface AgentRunToolRuntimeFactory {
  create(input: {
    projectRoot: string;
    permissionMode: PermissionMode;
  }): Promise<ToolCallRunner & ToolApprovalResumePort>;
}

export interface SessionRunToolDefinitionProvider {
  listDefinitions(input: {
    runId: string;
    permissionMode: PermissionMode;
    providerCapabilitySummary?: {
      supportsToolCall?: boolean;
    };
  }): ToolDefinition[];
}

export interface SessionRunProviderCapabilitySummaryProvider {
  getProviderCapabilitySummary(input: {
    providerId: string;
    modelId: string;
  }): { supportsToolCall?: boolean };
}

export interface SessionRunToolRegistrySnapshotService {
  createRunSnapshot(input: RunToolRegistrySnapshotBuildInput): RunToolRegistrySnapshotBuildResult;
}

export interface SessionRunAgentInstructionSourceService {
  loadInstructionSources(input: LoadInstructionSourcesInput): Promise<AgentInstructionSourceSnapshot[]>;
}

export interface SessionRunSessionContextInputService {
  buildSessionContextInput(input: BuildSessionContextInputFromRepositoryInput): SessionContextInput;
}

export interface SessionRunModelCallInputBuildService {
  buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
}

export interface SessionRunMemoryRecallInput {
  enabled?: boolean;
  homePath: string;
  sessionId: string;
  runId: string;
  modelStepId?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  effectiveCwd?: string | null;
  queryText: string;
  providerId?: string | null;
  modelId?: string | null;
  maxResults?: number;
  maxTokens?: number;
  createdAt?: string;
  toolSummaryMetadata?: JsonObject;
}

export interface SessionRunMemoryRecallService {
  recallForNewUserInput(input: SessionRunMemoryRecallInput): Promise<{
    memoryRecallSources: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  }>;
}

export interface SessionRunMemoryCaptureService {
  evaluateRunCompletedCapture(input: {
    homePath: string;
    runId: string;
    sessionId: string;
    projectId?: string | null;
    providerId?: ProviderId | null;
    modelId?: string | null;
    runStatus: 'completed';
    userText: string;
    assistantText?: string;
    toolActivitySummary?: string;
    signals?: MemoryCaptureSignal[];
    memoryEnabled?: boolean;
    hasProject?: boolean;
  }): Promise<{ status: string; reason?: string; savedMemoryIds?: string[] }>;
}

export interface SessionRunMemorySettingsProvider {
  isMemoryEnabled(): boolean;
}

export interface SessionRunMemoryMarkdownSyncService {
  syncProjectMirrorOnProjectOpened(input: { homePath: string; projectId: string }): Promise<unknown>;
}

export interface SessionRunGlobalInstructionDirectoryProvider {
  listGlobalInstructionDirs(input: { sessionId: string; runId: string; stepId: string }): string[];
}

export interface SessionRunSessionInstructionSourceProvider {
  listSessionInstructionSources(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): SessionInstructionSourceSnapshot[];
}

export interface SessionRunEffectiveCwdProvider {
  getRunEffectiveCwd(input: { sessionId: string; runId: string; stepId: string }): string | undefined;
}

export interface SessionRunWorkspaceChangeReadPort {
  listChangedFilesByRun(runId: string): WorkspaceChangedFile[];
  listChangeSetsByRun?(runId: string): WorkspaceChangeSet[];
  getChangeSummary?(changeSetId: string): WorkspaceChangeSummary | undefined;
  listChangedFilesByChangeSet?(changeSetId: string): WorkspaceChangedFile[];
}

export interface AgentRunServiceHomePaths {
  homePath: string;
  sqlitePath: string;
}

export interface AgentRunRepositoryPort {
  saveSession(session: Session): Session;
  getSession(sessionId: string): Session | undefined;
  saveMessage(message: SessionMessage): SessionMessage;
  getMessage(messageId: string): SessionMessage | undefined;
  saveRun(run: Run): Run;
  getRun(runId: string): Run | undefined;
  listRunsByStatuses(statuses: Run['status'][]): Run[];
  saveStep(step: RunStep): RunStep;
  listStepsByRun(runId: string): RunStep[];
  saveAction(action: RunAction): RunAction;
  saveObservation(observation: RunObservation): RunObservation;
  saveModelStep(modelStep: ModelStepRecord): ModelStepRecord;
  getModelStep(modelStepId: string): ModelStepRecord | undefined;
  getSessionCompaction(compactionId: string): SessionCompactionEntry | null;
  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent;
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}

export interface AgentRunServiceOptions {
  repository: AgentRunRepositoryPort;
  contextService?: SessionRunContextService;
  permissionSnapshotService?: Pick<
    PermissionSnapshotService,
    | 'createPermissionSnapshot'
    | 'linkAcceptedSourcePlan'
  >;
  planArtifactService?: PlanArtifactServicePort;
  modelStepProvider?: AgentRunModelStepProvider;
  toolRuntimeFactory?: AgentRunToolRuntimeFactory;
  toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  toolRegistrySnapshotService?: SessionRunToolRegistrySnapshotService;
  providerCapabilitySummaryProvider?: SessionRunProviderCapabilitySummaryProvider;
  toolRepository?: Pick<
    ToolRepository,
    'cancelPendingApprovalRequestsByRun' | 'cancelPendingToolExecutionsByRun' | 'failRunningToolExecutionsByRun' | 'markToolContinuationEmitted'
  >;
  agentInstructionSourceService?: SessionRunAgentInstructionSourceService;
  modelCallInputBuildService?: SessionRunModelCallInputBuildService;
  memoryRecallService?: SessionRunMemoryRecallService;
  memoryCaptureService?: SessionRunMemoryCaptureService;
  memorySettingsProvider?: SessionRunMemorySettingsProvider;
  memoryMarkdownSyncService?: SessionRunMemoryMarkdownSyncService;
  megumiHomePath?: string;
  globalInstructionDirectoryProvider?: SessionRunGlobalInstructionDirectoryProvider;
  sessionInstructionSourceProvider?: SessionRunSessionInstructionSourceProvider;
  runEffectiveCwdProvider?: SessionRunEffectiveCwdProvider;
  sessionContextInputService?: SessionRunSessionContextInputService;
  sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  sessionCompactionRepository?: SessionCompactionOrchestratorRepository;
  activePathRepository?: SessionActivePathRepository;
  sessionBranchService?: SessionBranchServicePort;
  workspaceChanges?: SessionRunWorkspaceChangeReadPort;
  hostBoundary?: RunHostBoundaryPort;
  chatStreamEventSink?: ChatStreamEventSink;
  timelineMessageRepository?: {
    listCommittedMessagesBySession(input: {
      projectId: string;
      sessionId: string;
    }): SessionTimelineListData;
  };
  clock?: AgentRunServiceClock;
  ids?: Partial<AgentRunServiceIds>;
}

export interface AgentRunPort {
  startRun(payload: RunStartPayload): Promise<{ run: Run; events: RuntimeEvent[] }>;
  sendSessionMessage(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }>;
  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean;
  resumeApproval(input: ResumeToolApprovalInput): AsyncIterable<RuntimeEvent> | undefined;
  createManualRetryFromRun(input: {
    requestId: string;
    runId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    retryAttempt: unknown;
    retryAttemptSourceEntry: unknown;
    events: RuntimeEvent[];
  };
  createManualRerunFromUserMessage(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    branchMarker: unknown;
    branchMarkerSourceEntry: unknown;
    seedMessage: unknown;
    retryAttempt: unknown;
    retryAttemptSourceEntry: unknown;
    events: RuntimeEvent[];
  };
  cleanupInterruptedRunsOnStartup(): { cleanedRunIds: string[] };
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
  getPlanByRun(runId: string): ImplementationPlanArtifactRecord | undefined;
  updatePlanStatus(input: PlanStatusUpdatePayload): ImplementationPlanArtifactRecord;
}

export interface ApprovalContinuationGroup {
  groupId: string;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  projectId?: string;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  userMessageId: string;
  pendingByApprovalId: Map<string, PendingToolApprovalContinuation>;
  resolvedResults: ToolResult[];
  toolRuntime: ToolCallRunner & ToolApprovalResumePort;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
}

export type AgentRunModelCallProvider = AgentRunModelStepProvider;
