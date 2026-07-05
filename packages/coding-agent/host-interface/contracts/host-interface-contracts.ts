/*
 * Host-facing Coding Agent controller contract.
 * This is not an Electron IPC contract; desktop, CLI, or web hosts may call it.
 */
import type { ArtifactController } from '../artifacts/artifact-controller';
import type { PlanController } from '../artifacts/plan-controller';
import type { ApprovalController } from '../controllers/approval-controller';
import type { ChatController } from '../controllers/chat-controller';
import type { SettingsController } from '../controllers/settings-controller';
import type { WorkspaceController } from '../controllers/workspace-controller';

export interface CodingAgentHostInterface {
  workspace: WorkspaceController;
  chat: ChatController;
  settings: SettingsController;
  approval: ApprovalController;
  artifacts: ArtifactController & { plan: PlanController };
  dispose?(): void | Promise<void>;
}
