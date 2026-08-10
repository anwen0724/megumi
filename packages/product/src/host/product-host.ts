/*
 * Aggregates the product-facing Host interfaces consumed by UI, CLI, and web shells.
 * This is not an Electron IPC contract; desktop, CLI, or web hosts may call it.
 */
import type { ApprovalHost } from './approval-host';
import type { SessionHost } from './session-host';
import type { SettingsHost } from './settings-host';
import type { SkillHost } from './skill-host';
import type { WorkspaceHost } from './workspace-host';
import type { ObservabilityHost } from './observability-host';
import type { VoiceHost } from './voice-host';

export interface ProductHostInterface {
  workspace: WorkspaceHost;
  session: SessionHost;
  skill: SkillHost;
  settings: SettingsHost;
  approval: ApprovalHost;
  observability: ObservabilityHost;
  voice: VoiceHost;
}
