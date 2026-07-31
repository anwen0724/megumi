/*
 * Composes ContextService from owner services and the shared AI Models
 * collection. Context itself owns model-facing materialization and compaction.
 */
import type { SessionUsageSnapshot } from '../domain/model/context-usage';
import type { ContextService } from '../service/context-service';
import {
  ContextServiceImpl,
  type ContextServiceDependencies,
} from '../service/context-service-impl';

export type ComposeAgentContextInput = Omit<
  ContextServiceDependencies,
  'usageSnapshotCache'
> & {
  usageSnapshotCache?: ContextServiceDependencies['usageSnapshotCache'];
};

export function composeAgentContext(input: ComposeAgentContextInput): {
  contextService: ContextService;
} {
  const contextService = new ContextServiceImpl({
    ...input,
    usageSnapshotCache: input.usageSnapshotCache ?? new Map<string, SessionUsageSnapshot>(),
  });
  return { contextService };
}
