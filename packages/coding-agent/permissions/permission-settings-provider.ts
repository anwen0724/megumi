// Defines how the host interface obtains project permission settings without depending on a UI shell.
import type { MergedPermissionSettings } from '@megumi/shared/permission';

export interface PermissionSettingsProvider {
  loadForProject(projectRoot: string): Promise<MergedPermissionSettings>;
}
