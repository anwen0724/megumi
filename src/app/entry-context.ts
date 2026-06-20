// Defines caller metadata for entrypoints that use the Agent Platform App API.
export type AppEntryKind = 'desktop' | 'web' | 'cli' | 'test';

export interface AppEntryCapabilities {
  streaming?: boolean;
  approval?: boolean;
  filePicker?: boolean;
  workspacePanel?: boolean;
}

export interface AppEntryContext {
  clientKind: AppEntryKind;
  requestId: string;
  createdAt: string;
  capabilities?: AppEntryCapabilities;
  workspaceHint?: string;
  metadata?: Record<string, unknown>;
}
