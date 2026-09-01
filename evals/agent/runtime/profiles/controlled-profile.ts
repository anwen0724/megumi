/* Builds deterministic external adapters while preserving the real Product Runtime. */
import { createControlledWebTools } from '../adapters/controlled-web-tools';
import { controlledPermissionSettings, driveControlledApprovals } from '../adapters/controlled-approval';
import {
  createControlledDiscoverySourceRegistry,
  describeControlledDiscoverySources,
} from '../adapters/controlled-discovery-source';
import type { EvaluationFixture } from '../../fixtures/fixture';

export interface ControlledTimerDriver {
  readonly timers: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  runDue(): void;
}

export function createControlledProfile(fixture: EvaluationFixture) {
  const timerDriver = createControlledTimers();
  const webTools = createControlledWebTools(fixture);
  return {
    profile: 'controlled' as const,
    now: () => fixture.clock,
    createId: createDeterministicIdFactory(fixture.fixtureId),
    ...webTools,
    discoverySourceRegistry: createControlledDiscoverySourceRegistry({ fixture, ...webTools }),
    timerDriver,
    permissionSettings: controlledPermissionSettings(fixture),
    driveApprovals: driveControlledApprovals,
    sourceDescription: describeControlledDiscoverySources(fixture),
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
