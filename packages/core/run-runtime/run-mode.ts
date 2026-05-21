import type { PermissionMode, RunMode } from '@megumi/shared/run-mode-contracts';
import { PermissionModeSchema } from '@megumi/shared/run-mode-contracts';

export interface ResolveRunModeSnapshotInput {
  permissionMode?: string;
  mode?: string;
  modeSnapshot?: RunMode;
}

export interface PermissionModeRuntimeInstruction {
  permissionMode: PermissionMode;
  instruction: string;
}

export function resolveRunModeSnapshot(input: ResolveRunModeSnapshotInput): RunMode {
  if (input.modeSnapshot) {
    return {
      permissionMode: PermissionModeSchema.parse(input.modeSnapshot.permissionMode),
      ...(input.modeSnapshot.source ? { source: input.modeSnapshot.source } : {}),
    };
  }

  return {
    permissionMode: PermissionModeSchema.parse(input.permissionMode ?? input.mode ?? 'default'),
    source: 'system',
  };
}

export function createPermissionModeRuntimeInstruction(mode: RunMode): PermissionModeRuntimeInstruction {
  const permissionMode = PermissionModeSchema.parse(mode.permissionMode);

  if (permissionMode === 'plan') {
    return {
      permissionMode,
      instruction: 'Plan mode: read and analyze project context, ask for verification commands, deny writes and unknown commands.',
    };
  }

  if (permissionMode === 'accept_edits') {
    return {
      permissionMode,
      instruction: 'Accept edits mode: ordinary project edits and verification commands may proceed when policy allows them.',
    };
  }

  if (permissionMode === 'auto') {
    return {
      permissionMode,
      instruction: 'Auto mode: use rule-based permission classification and preserve auditable reasons for automatic decisions.',
    };
  }

  return {
    permissionMode,
    instruction: 'Default mode: read-only project context may proceed; writes and commands require ask-first policy handling.',
  };
}

export const createRunModeRuntimeInstruction = createPermissionModeRuntimeInstruction;
