/*
 * Aggregates the product-facing Host interfaces consumed by UI, CLI, and web shells.
 * This is not an Electron IPC contract; desktop, CLI, or web hosts may call it.
 */
import type { ArtifactHost } from './artifact-host';
import type { PlanHost } from './plan-host';
import type { ApprovalHost } from './approval-host';
import type { ChatHost } from './chat-host';
import type { SettingsHost } from './settings-host';
import type { SkillHost } from './skill-host';
import type { WorkspaceHost } from './workspace-host';

export interface ProductHostInterface {
  workspace: WorkspaceHost;
  chat: ChatHost;
  skill: SkillHost;
  settings: SettingsHost;
  approval: ApprovalHost;
  artifacts: ArtifactHost;
  plan: PlanHost;
}
