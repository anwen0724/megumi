/* Exposes memory operations and reads status without scheduling model work. */
import { builtinProviders } from '@megumi/ai/providers/all';
import { resolveModel } from '../settings/resolve-model';
import type { MemoryArtifactState, MemoryHost, MemoryModelCapability } from './contracts';
import type { ModelSelection } from '../contracts';
import { createMemoryProduction, type MemoryProductionOptions } from './memory-production';
import { createMemoryQueries } from './memory-queries';
import { createTaskMemory, type PromptMemory } from './memory-consumption';
import { createMemoryUsage } from './memory-usage';

export function createMemory(options: MemoryProductionOptions): MemoryHost {
  const production = createMemoryProduction(options);
  const queries = createMemoryQueries({
    files: options.files,
    sources: options.sources,
    excluded: sessionId =>
      options.database
        .prepare<{
          eligibility: string;
        }>({ sql: 'SELECT eligibility FROM memory_sources WHERE session_id = ?' })
        .get([sessionId])?.eligibility === 'excluded',
  });
  const recordUsage = createMemoryUsage(options);
  recordUsage();

  function consumptionState(): {
    status: PromptMemory['status'];
    controlRevision: number;
    snapshotId?: string;
  } {
    try {
      const read = options.settings.readSettings();
      if (read.status !== 'ok') throw new Error();
      production.inspect();
      const state = options.database
        .prepare<{
          artifact_state: MemoryArtifactState;
          control_revision: number;
          successful_snapshot_id: string | null;
          clear_pending: number;
        }>({
          sql: 'SELECT artifact_state, control_revision, successful_snapshot_id, clear_pending FROM memory_state WHERE id = 1',
        })
        .get();
      if (!state) throw new Error();
      const status = state.clear_pending
        ? 'clearing'
        : !read.settings.config.memory.useMemories
          ? 'disabled'
          : state.artifact_state === 'empty' && options.files.hasArtifacts()
            ? 'needsRepair'
            : state.artifact_state;
      return {
        status,
        controlRevision: state.control_revision,
        snapshotId: state.successful_snapshot_id ?? undefined,
      };
    } catch {
      return {
        status: 'unavailable',
        controlRevision: 0,
      };
    }
  }

  function capability(selection?: ModelSelection): MemoryModelCapability {
    if (!selection) return { status: 'unconfigured' };
    // Only the application-level Settings instance is injected. Never fall back to the chat model.
    const resolved = resolveModel({
      settings: options.settings,
      selection,
      builtins: builtinProviders(),
    });
    return resolved.status === 'ok'
      ? {
          status: 'configured',
          selection,
        }
      : {
          status: 'unavailable',
          selection,
          message: resolved.failure.message,
        };
  }
  return {
    ...production,
    ...queries,
    recordUsage,
    createTaskMemory: request =>
      createTaskMemory(request, {
        files: options.files,
        root: options.root,
        queries,
        state: consumptionState,
        observability: options.observability,
      }),
    getStatus() {
      const read = options.settings.readSettings();
      if (read.status === 'rejected')
        return {
          status: 'failed',
          error: {
            code: 'SETTINGS_INVALID',
            message: read.error.message,
          },
        };
      try {
        production.inspect();
        const state = options.database
          .prepare<{
            artifact_state: MemoryArtifactState;
            dirty_revision: number;
            processed_revision: number;
            successful_snapshot_id: string | null;
          }>({
            sql: 'SELECT artifact_state, dirty_revision, processed_revision, successful_snapshot_id FROM memory_state WHERE id = 1',
          })
          .get();
        if (!state) throw new Error('Memory state is missing.');
        // Untracked files are not a successful generation and must never be silently imported.
        const artifactState =
          state.artifact_state === 'empty' && options.files.hasArtifacts()
            ? 'needsRepair'
            : state.artifact_state;
        const configuration = read.settings.config.memory;
        return {
          status: 'ok',
          memory: {
            generateMemories: configuration.generateMemories,
            useMemories: configuration.useMemories,
            extractModel: capability(configuration.extractModel),
            consolidationModel: capability(configuration.consolidationModel),
            artifactState,
            dirty: state.dirty_revision > state.processed_revision,
            dirtyRevision: state.dirty_revision,
            processedRevision: state.processed_revision,
            ...(state.successful_snapshot_id
              ? { successfulSnapshotId: state.successful_snapshot_id }
              : {}),
            sourceCount: options.sources.listSources().length,
            recentRuns: options.database
              .prepare<{ run_id: string }>({
                sql: "SELECT run_id FROM memory_runs WHERE kind <> 'extract' ORDER BY rowid DESC LIMIT 10",
              })
              .all()
              .map(row => production.getRun(row.run_id)!),
          },
        };
      } catch {
        return {
          status: 'failed',
          error: {
            code: 'STORAGE_FAILED',
            message: 'Memory state could not be read.',
          },
        };
      }
    },
  };
}
