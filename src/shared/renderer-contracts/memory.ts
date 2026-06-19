// Renderer-facing memory DTOs. Backend implementation remains out of Phase 21.
export interface MemorySettings {
  enabled?: boolean;
  [key: string]: unknown;
}
