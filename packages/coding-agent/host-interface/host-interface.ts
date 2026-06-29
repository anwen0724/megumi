// Defines the external host-facing interface for UI, CLI, web, and other shells.
import type { InputService } from '../input';
import type { ArtifactController } from './artifacts/artifact-controller';
import type { PlanController } from './artifacts/plan-controller';
import type { ApprovalController } from './permissions/approval-controller';
import type { ProviderController } from './settings/provider-controller';
import type { SettingsController } from './settings/settings-controller';
import type { SessionBranchController } from './session/branch-controller';
import type { SessionController } from './session/session-controller';
import type { WorkspaceController } from './workspace/workspace-controller';

export type InputController = InputService;
export type HostWorkspaceController = WorkspaceController;
export type HostSessionController = SessionController & SessionBranchController;
export type HostSettingsController = SettingsController & { provider: ProviderController };
export type HostPermissionController = ApprovalController;
export type HostArtifactController = ArtifactController & { plan: PlanController };

export interface CodingAgentHostInterface {
  input: InputController;
  workspace: HostWorkspaceController;
  session: HostSessionController;
  settings: HostSettingsController;
  permissions: HostPermissionController;
  artifacts: HostArtifactController;
  dispose(): void;
}

export interface CreateCodingAgentHostInterfaceOptions {
  input: InputController;
  workspace: HostWorkspaceController;
  session: HostSessionController;
  settings: HostSettingsController;
  permissions: HostPermissionController;
  artifacts: HostArtifactController;
  dispose(): void;
}

export function createCodingAgentHostInterface(
  options: CreateCodingAgentHostInterfaceOptions,
): CodingAgentHostInterface {
  return {
    input: options.input,
    workspace: options.workspace,
    session: options.session,
    settings: options.settings,
    permissions: options.permissions,
    artifacts: options.artifacts,
    dispose: options.dispose,
  };
}
