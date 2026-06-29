// Defines the product run service contract consumed by runtime composition and UI shells.
import type {
  SessionTimelineListData,
} from '@megumi/shared/ipc';
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
  CompactIfNeededInput,
  AgentInstructionSourcePort,
  AgentLoopInitialModelInputSourceOverrideProvider,
  ModelCallInputBuildPort,
  RunBaselineContextPort,
  SessionCompactionOrchestratorRepository,
  SessionCompactionOrchestrationResult,
} from '../context';
import type {
  MemoryProjectMirrorSyncPort,
  MemoryRecallPort,
} from '../memory';
import type { MemorySettingsPort } from '../settings';
import type {
  SessionBranchServicePort,
  SessionContextInputBuildPort,
} from '../session';
import type {
  ToolRuntimeFactory,
} from '../agent-loop/tool-call';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type {
  ToolSetCapabilityProvider,
  ToolSetRegistryProvider,
} from '../agent-loop';
import type { RunHostBoundaryPort, RunIdFactory } from '../state/lifecycle';
import type {
  RunRetryCoordinatorPort,
  RunTerminalCoordinatorPort,
} from '../state';
import type {
  PostRunHooksPort,
} from '../hooks';
import type {
  ToolRegistrySnapshotServicePort,
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
  contextService?: RunBaselineContextPort;
  permissionSnapshotService?: Pick<
    PermissionSnapshotService,
    | 'createPermissionSnapshot'
    | 'linkAcceptedSourcePlan'
  >;
  planArtifactService?: PlanArtifactServicePort;
  modelStepProvider?: ModelCallProvider;
  toolRuntimeFactory?: ToolRuntimeFactory;
  toolDefinitionProvider?: ToolSetRegistryProvider;
  toolRegistrySnapshotService?: ToolRegistrySnapshotServicePort;
  providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;
  toolRepository?: AgentRunToolRepositoryPort;
  agentInstructionSourceService?: AgentInstructionSourcePort;
  modelCallInputBuildService?: ModelCallInputBuildPort;
  memoryRecallService?: MemoryRecallPort;
  memorySettingsProvider?: MemorySettingsPort;
  memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  megumiHomePath?: string;
  modelInputSourceOverrideProvider?: AgentLoopInitialModelInputSourceOverrideProvider;
  sessionContextInputService?: SessionContextInputBuildPort;
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
