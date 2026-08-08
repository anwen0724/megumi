/*
 * Aggregates the product-facing Host interfaces consumed by UI, CLI, and web shells.
 * This is not an Electron IPC contract; desktop, CLI, or web hosts may call it.
 */
import type { ArtifactHost } from './artifact-host';
import type { ApprovalHost } from './approval-host';
import type { SessionHost } from './session-host';
import type { SettingsHost } from './settings-host';
import type { SkillHost } from './skill-host';
import type { WorkspaceHost } from './workspace-host';
import type { ObservabilityHost } from './observability-host';

export interface ProductHostInterface {
  workspace: WorkspaceHost;
  session: SessionHost;
  skill: SkillHost;
  settings: SettingsHost;
  approval: ApprovalHost;
  /** Transitional placeholder removed with the Desktop IPC migration in Task 6. */
  artifacts: ArtifactHost;
  observability: ObservabilityHost;
}
