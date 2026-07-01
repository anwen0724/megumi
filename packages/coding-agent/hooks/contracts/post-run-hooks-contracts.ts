/*
 * Public post-run hook contracts exposed by the Coding Agent hook module.
 */
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { WorkspaceChangedFile } from '@megumi/shared/workspace';
import type { MemoryCapturePort } from '../../memory';
import type { ChatStreamEventAdapter } from '../../projections/chat-stream';
import type { WorkspaceChangeFooterProjectorService } from '../../workspace';

export interface PostRunHooksRepositoryPort {
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}

export interface PostRunHooksWorkspaceChangeReadPort {
  listChangedFilesByRun(runId: string): WorkspaceChangedFile[];
}

export interface PostRunHooksCoordinatorOptions {
  repository: PostRunHooksRepositoryPort;
  memoryCaptureService?: MemoryCapturePort;
  megumiHomePath?: string;
  workspaceChanges?: PostRunHooksWorkspaceChangeReadPort;
  workspaceChangeFooterProjector?: WorkspaceChangeFooterProjectorService;
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
    chatStreamAdapter?: Pick<ChatStreamEventAdapter, 'publishWorkspaceChangeFooter'>;
  }): void;
  publishWorkspaceChangeFooter(input: {
    runId: string;
    createdAt: string;
    chatStreamAdapter?: Pick<ChatStreamEventAdapter, 'publishWorkspaceChangeFooter'>;
  }): void;
}
