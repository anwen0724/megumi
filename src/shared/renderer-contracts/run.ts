// Renderer-facing run context DTOs.
import type { JsonObject, JsonValue } from '../json';

export interface RunContextSource {
  sourceId?: string;
  id?: string;
  sourceKind?: string;
  kind?: string;
  sourceUri?: string;
  title?: string;
  content?: JsonValue;
  workspaceId?: string;
  workspacePath?: string;
  relativePath?: string;
  metadata?: JsonObject;
}

export interface RunContext {
  contextId?: string;
  runId: string;
  sessionId?: string;
  goal?: string;
  sources?: RunContextSource[];
  resourceRefs?: RunContextSource[];
  workspaceSources?: RunContextSource[];
  metadata?: JsonObject;
}
