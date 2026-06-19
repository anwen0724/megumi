// Defines caller metadata for entrypoints that use the Agent Platform App API.
export type AppClientKind = 'desktop' | 'web' | 'cli' | 'test';

export interface AppClientCapabilities {
  streaming?: boolean;
  approval?: boolean;
  filePicker?: boolean;
  workspacePanel?: boolean;
}

export interface AppClientContext {
  clientKind: AppClientKind;
  requestId: string;
  createdAt: string;
  capabilities?: AppClientCapabilities;
  workspaceHint?: string;
  metadata?: Record<string, unknown>;
}
