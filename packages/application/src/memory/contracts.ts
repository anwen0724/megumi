/* Defines the implemented, renderer-safe Memory query boundary. */
import type { ModelSelection } from '../contracts';

export type MemoryArtifactState = 'empty' | 'ready' | 'updating' | 'needsRepair' | 'clearing';
export type MemoryModelCapability =
  | { readonly status: 'unconfigured' }
  | { readonly status: 'configured'; readonly selection: ModelSelection }
  | { readonly status: 'unavailable'; readonly selection: ModelSelection; readonly message: string };

export interface MemoryStatus {
  readonly generateMemories: boolean;
  readonly useMemories: boolean;
  readonly extractModel: MemoryModelCapability;
  readonly consolidationModel: MemoryModelCapability;
  readonly artifactState: MemoryArtifactState;
  readonly dirty: boolean;
  readonly dirtyRevision: number;
  readonly processedRevision: number;
  readonly successfulSnapshotId?: string;
  readonly sourceCount: number;
}

export interface MemoryHost {
  getStatus(): { readonly status: 'ok'; readonly memory: MemoryStatus }
    | { readonly status: 'failed'; readonly error: { readonly code: 'SETTINGS_INVALID' | 'STORAGE_FAILED'; readonly message: string } };
}
