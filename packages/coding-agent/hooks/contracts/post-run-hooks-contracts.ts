/*
 * Public post-run hook contracts exposed by the Coding Agent hook module.
 */
import type { RuntimeEvent } from '../../events';
import type { WorkspaceChangeService } from '../../workspace';
import type { MemoryCapturePort } from '../../memory';

export interface PostRunHooksRepositoryPort {
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}

export interface PostRunHooksWorkspaceChangeReadPort {
  listChangedFiles: Pick<WorkspaceChangeService, 'listChangedFiles'>['listChangedFiles'];
}

export interface PostRunHooksCoordinatorOptions {
  repository: PostRunHooksRepositoryPort;
  memoryCaptureService?: MemoryCapturePort;
  megumiHomePath?: string;
  workspaceChanges?: PostRunHooksWorkspaceChangeReadPort;
}

export interface ScheduleRunCompletedMemoryCaptureInput {
  runId: string;
  sessionId: string;
  projectId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  userText: string;
  assistantText: string;
  hasProject: boolean;
  memoryEnabled?: boolean;
}

export interface PostRunHooksPort {
  scheduleRunCompletedMemoryCapture(input: ScheduleRunCompletedMemoryCaptureInput): void;
  publishRunTerminalHooks(input: {
    event: RuntimeEvent;
  }): void;
}
