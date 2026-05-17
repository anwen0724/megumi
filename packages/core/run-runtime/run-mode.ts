import type { RunActionKind } from '@megumi/shared/session-run-contracts';
import {
  RUN_MODE_PRESET_DEFAULTS,
  type PermissionMode,
  type RunMode,
  isActivePermissionMode,
} from '@megumi/shared/run-mode-contracts';

export interface ResolveRunModeSnapshotInput {
  mode: string;
  modeSnapshot?: RunMode;
}

export interface RunModeRuntimeInstruction {
  taskIntent: RunMode['taskIntent'];
  permissionMode: PermissionMode;
  outputExpectation: RunMode['outputExpectation'];
  instruction: string;
}

export function resolveRunModeSnapshot(input: ResolveRunModeSnapshotInput): RunMode {
  if (input.modeSnapshot) {
    assertRuntimePermissionModeSupported(input.modeSnapshot);
    return input.modeSnapshot;
  }

  const preset = input.mode in RUN_MODE_PRESET_DEFAULTS
    ? input.mode as keyof typeof RUN_MODE_PRESET_DEFAULTS
    : 'chat';
  const mode = RUN_MODE_PRESET_DEFAULTS[preset];
  assertRuntimePermissionModeSupported(mode);
  return mode;
}

export function assertRuntimePermissionModeSupported(mode: RunMode): void {
  if (!isActivePermissionMode(mode.permissionMode)) {
    throw new Error(
      `Permission mode ${mode.permissionMode} is reserved for a later capability stage.`,
    );
  }
}

export function defaultActionKindForRunMode(mode: RunMode): RunActionKind {
  assertRuntimePermissionModeSupported(mode);

  if (mode.outputExpectation === 'implementation_plan_artifact') {
    return 'create_artifact';
  }

  return 'emit_message';
}

export function createRunModeRuntimeInstruction(mode: RunMode): RunModeRuntimeInstruction {
  assertRuntimePermissionModeSupported(mode);

  if (mode.permissionMode === 'plan') {
    return {
      taskIntent: mode.taskIntent,
      permissionMode: mode.permissionMode,
      outputExpectation: mode.outputExpectation,
      instruction: 'Produce a reviewable implementation plan. Do not modify files or run side-effecting commands.',
    };
  }

  return {
    taskIntent: mode.taskIntent,
    permissionMode: mode.permissionMode,
    outputExpectation: mode.outputExpectation,
    instruction: 'Produce the requested response within the current runtime and host boundaries.',
  };
}
