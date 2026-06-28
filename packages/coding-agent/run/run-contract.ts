// Defines the product run service contract consumed by runtime composition and UI shells.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  SessionTimelineListData,
} from '@megumi/shared/ipc';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContextBuildRequest,
  ModelStepRuntimeRequest,
  SessionInstructionSourceSnapshot,
} from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';
import type { PermissionMode } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { RunContext, ModelCapabilitySummary } from '@megumi/shared/run';
import type { Run, RunStep } from '@megumi/shared/session';
import type { SessionContextInput } from '@megumi/shared/session';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool';
import type { MemoryCaptureSignal } from '@megumi/shared/memory';

import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import type {
  AgentRunExecutionFactRepositoryPort,
  AgentRunMessageRepositoryPort,
  AgentRunModelStepRepositoryPort,
  AgentRunRunRecordRepositoryPort,
  AgentRunRuntimeEventRepositoryPort,
  AgentRunSessionContextRepositoryPort,
  AgentRunSessionRepositoryPort,
  AgentRunToolRepositoryPort,
} from '../persistence';
import type {
  PermissionSnapshotService,
} from '../permissions/permission-snapshot-service';
import type { PlanArtifactServicePort } from '../artifacts';
import type {
  BuildModelCallInputInput,
  BuildModelCallInputResult,
  CompactIfNeededInput,
  LoadInstructionSourcesInput,
  ModelInputMemoryRecallSource,
  SessionCompactionOrchestratorRepository,
  SessionCompactionOrchestrationResult,
} from '../context';
import type {
  BuildSessionContextInputFromRepositoryInput,
  SessionBranchServicePort,
} from '../session';
import type {
  PendingToolApprovalResume,
  ToolRuntimeFactory,
} from '../agent-loop/tool-call';
import type { ToolCallRunnerService } from '../agent-loop/tool-call';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { RunHostBoundaryPort, RunIdFactory } from '../state/lifecycle';
import type {
  RunRetryCoordinatorPort,
  RunTerminalCoordinatorPort,
} from '../state';
import type {
  PostRunHooksPort,
} from '../hooks';
import type {
  RunToolRegistrySnapshotBuildInput,
  RunToolRegistrySnapshotBuildResult,
} from '../tools/tool-registry-snapshot';
import type {
  ChatStreamEventSink,
} from '../projections/chat-stream';
import type { WorkspaceChangeReadPort } from '../workspace';

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

export interface AgentRunServiceHomePaths {
  homePath: string;
  sqlitePath: string;
}

export interface AgentRunServiceOptions {
  sessionRepository: AgentRunSessionRepositoryPort;
  messageRepository: AgentRunMessageRepositoryPort;
  runRecordRepository: AgentRunRunRecordRepositoryPort;
  runExecutionFactRepository: AgentRunExecutionFactRepositoryPort;
  modelStepRepository: AgentRunModelStepRepositoryPort;
  sessionContextRepository: AgentRunSessionContextRepositoryPort;
  runtimeEventRepository: AgentRunRuntimeEventRepositoryPort;
  postRunHooks: PostRunHooksPort;
  runTerminalCoordinator: RunTerminalCoordinatorPort;
  runRetryCoordinator: RunRetryCoordinatorPort;
  contextService?: SessionRunContextService;
  permissionSnapshotService?: Pick<
    PermissionSnapshotService,
    | 'createPermissionSnapshot'
    | 'linkAcceptedSourcePlan'
  >;
  planArtifactService?: PlanArtifactServicePort;
  modelStepProvider?: ModelCallProvider;
  toolRuntimeFactory?: ToolRuntimeFactory;
  toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  toolRegistrySnapshotService?: SessionRunToolRegistrySnapshotService;
  providerCapabilitySummaryProvider?: SessionRunProviderCapabilitySummaryProvider;
  toolRepository?: AgentRunToolRepositoryPort;
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
  workspaceChanges?: WorkspaceChangeReadPort;
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

export interface ApprovalResumeGroup {
  groupId: string;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  projectId?: string;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  userMessageId: string;
  pendingByApprovalId: Map<string, PendingToolApprovalResume>;
  resolvedResults: ToolResult[];
  toolRuntime: ToolCallRunnerService;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
}
