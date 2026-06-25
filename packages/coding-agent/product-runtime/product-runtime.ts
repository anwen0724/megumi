// Defines the complete Coding Agent product runtime exposed to UI shells and non-desktop entries.
// Every member is a product-owned port interface — this is the single shell-agnostic
// contract that desktop, and future web/cli shells, code against.
import type { SessionRunPort } from '../run/session-run-service';
import type { RecoveryService } from '../run/recovery-service';
import type { ToolService } from '../tools/tool-service-port';
import type { ArtifactServicePort } from '../artifacts';
import type { MemoryService } from '../memory';
import type { RunContextServicePort } from '../run/resources';
import type { ProviderSettingsPort } from '../settings';
import type { ProjectService } from '../workspace';

export interface CodingAgentProductRuntime {
  sessionRunService: SessionRunPort;
  recoveryService: RecoveryService;
  toolService: ToolService;
  artifactService: ArtifactServicePort;
  memoryService: MemoryService;
  runContextService: RunContextServicePort;
  providerSettingsService: ProviderSettingsPort;
  projectService: ProjectService;
  dispose(): void;
}
