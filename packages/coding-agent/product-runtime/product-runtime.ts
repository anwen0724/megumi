// Defines the complete Coding Agent product runtime exposed to UI shells and non-desktop entries.
import type { SessionRunService } from '../run/session-run-service';
import type { RecoveryService } from '../run/recovery-service';
import type { ToolService } from '../tools/tool-service-port';
import type { ArtifactService } from '../artifacts';
import type { MemoryService } from '../memory';
import type { RunContextService } from '../resources';
import type { ProviderSettingsService } from '../settings';
import type { ProjectService } from '../workspace';

export interface CodingAgentProductRuntime {
  sessionRunService: SessionRunService;
  recoveryService: RecoveryService;
  toolService: ToolService;
  artifactService: ArtifactService;
  memoryService: MemoryService;
  runContextService: RunContextService;
  providerSettingsService: ProviderSettingsService;
  projectService: ProjectService;
  dispose(): void;
}
