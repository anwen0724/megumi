// Defines the complete Coding Agent product runtime exposed to UI shells and non-desktop entries.
// Every member is a product-owned port interface — this is the single shell-agnostic
// contract that desktop, and future web/cli shells, code against.
import type { AgentRunPort } from '../run/run-contract';
import type { RecoveryService } from '../run/recovery';
import type { SessionBranchServicePort, SessionServicePort } from '../session';
import type { ToolService } from '../tools/tool-service-port';
import type { ArtifactServicePort, PlanArtifactServicePort } from '../artifacts';
import type { MemoryService } from '../memory';
import type { RunContextServicePort } from '../run/context/resources';
import type { ProviderSettingsPort } from '../settings';
import type { ProjectService } from '../workspace';

export interface CodingAgentProductRuntime {
  sessionService: SessionServicePort;
  sessionBranchService: SessionBranchServicePort;
  agentRunService: AgentRunPort;
  recoveryService: RecoveryService;
  toolService: ToolService;
  artifactService: ArtifactServicePort;
  planArtifactService: PlanArtifactServicePort;
  memoryService: MemoryService;
  runContextService: RunContextServicePort;
  providerSettingsService: ProviderSettingsPort;
  projectService: ProjectService;
  dispose(): void;
}
