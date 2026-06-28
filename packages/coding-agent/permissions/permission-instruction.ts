import type { PermissionMode, PermissionModeState } from '@megumi/shared/permission';
import { PermissionModeSchema } from '@megumi/shared/permission';

export interface ResolvePermissionModeStateInput {
  permissionMode?: string;
  permissionModeState?: PermissionModeState;
}

export interface PermissionModeRuntimeInstruction {
  permissionMode: PermissionMode;
  instruction: string;
}

export function resolvePermissionModeState(input: ResolvePermissionModeStateInput): PermissionModeState {
  if (input.permissionModeState) {
    return {
      permissionMode: PermissionModeSchema.parse(input.permissionModeState.permissionMode),
      ...(input.permissionModeState.source ? { source: input.permissionModeState.source } : {}),
    };
  }

  return {
    permissionMode: PermissionModeSchema.parse(input.permissionMode ?? 'default'),
    source: 'system',
  };
}

export function createPermissionModeRuntimeInstruction(
  state: PermissionModeState,
): PermissionModeRuntimeInstruction {
  const permissionMode = PermissionModeSchema.parse(state.permissionMode);

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

