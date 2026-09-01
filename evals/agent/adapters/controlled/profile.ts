/* Builds deterministic external adapters while preserving the real Product Runtime. */
import { createControlledWebTools } from './web-tools';
import { controlledPermissionSettings, driveControlledApprovals } from './approval';
import {
  createControlledDiscoverySourceRegistry,
  describeControlledDiscoverySources,
} from './discovery-source';
import type { EvaluationInitialState } from '../../contracts/evaluation-task';

export interface ControlledTimerDriver {
  readonly timers: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  runDue(): void;
}

export function createControlledProfile(input: {
  readonly taskId: string;
  readonly initialState: EvaluationInitialState;
}) {
  const timerDriver = createControlledTimers();
  const webTools = createControlledWebTools(input.initialState);
  return {
    profile: 'controlled' as const,
    now: () => input.initialState.clock,
    createId: createDeterministicIdFactory(input.taskId),
    ...webTools,
    discoverySourceRegistry: createControlledDiscoverySourceRegistry({ initialState: input.initialState, ...webTools }),
    timerDriver,
    permissionSettings: controlledPermissionSettings(input.initialState),
    driveApprovals: driveControlledApprovals,
    sourceDescription: describeControlledDiscoverySources(input.initialState),
  };
}

function createDeterministicIdFactory(prefix: string): (scope: string) => string {
  const counters = new Map<string, number>();
  return (scope) => {
    const next = (counters.get(scope) ?? 0) + 1;
    counters.set(scope, next);
    return `evaluation:${prefix}:${scope}:${next}`;
  };
}

function createControlledTimers(): ControlledTimerDriver {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  return {
    timers: {
      setTimeout(callback) {
        const handle = ++nextHandle;
        callbacks.set(handle, callback);
        return handle;
      },
      clearTimeout(handle) {
        if (typeof handle === 'number') callbacks.delete(handle);
      },
    },
    runDue() {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of due) callback();
    },
  };
}
