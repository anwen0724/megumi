/* Builds deterministic external adapters while preserving the real Product Runtime. */
import { createControlledWebTools } from './web-tools';
import { controlledPermissionSettings, driveControlledApprovals } from './approval';
import {
  createControlledDiscoverySourceRegistry,
  describeControlledDiscoverySources,
} from './discovery-source';
import type { CaseInitialState } from '../../run/initial-state';
import { createControlledClock } from './clock';

export function createControlledProfile(input: {
  readonly caseId: string;
  readonly initialState: CaseInitialState;
}) {
  const timerDriver = createControlledClock(input.initialState.clock);
  const webTools = createControlledWebTools(input.initialState);
  return {
    profile: 'controlled' as const,
    now: timerDriver.now,
    createId: createDeterministicIdFactory(input.caseId),
    ...webTools,
    discoverySourceRegistry: createControlledDiscoverySourceRegistry({ initialState: input.initialState, ...webTools }),
    timerDriver,
    permissionSettings: controlledPermissionSettings(input.initialState),
    driveApprovals: (runtime: Parameters<typeof driveControlledApprovals>[0]) => (
      driveControlledApprovals(runtime, input.initialState.approvalDecisions)
    ),
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

