/* Fixes the source versions and selection diff used by one consolidation attempt. */
import type { DatabaseConnection } from '../storage/index';
import type { MemorySources } from './source-contracts';
import type { MemoryConfiguration } from './extraction-contracts';
import { createHash } from 'node:crypto';

export interface ConsolidationSource {
  readonly sessionId: string;
  readonly sourceVersion: string;
  readonly sourceRef: string;
  readonly workspaceId: string | null;
  readonly sourceUpdatedAt: string;
  readonly rawMemory: string;
  readonly rolloutSummary: string;
  readonly coverage: unknown;
  readonly artifactPath: string;
}
export interface ConsolidationSelection {
  readonly targetRevision: number;
  readonly selected: readonly ConsolidationSource[];
  readonly previous: readonly ConsolidationSource[];
  readonly added: readonly ConsolidationSource[];
  readonly removed: readonly ConsolidationSource[];
  readonly retained: readonly ConsolidationSource[];
}
type SourceRow = {
  session_id: string; source_version: string; workspace_id: string | null; source_updated_at: string;
  raw_memory: string; rollout_summary: string; coverage_json: string;
};

function material(row: SourceRow): ConsolidationSource {
  const coverage = JSON.parse(row.coverage_json);
  const key = createHash('sha256').update(row.session_id).digest('hex');
  return { sessionId: row.session_id, sourceVersion: row.source_version, workspaceId: row.workspace_id,
    sourceUpdatedAt: row.source_updated_at, rawMemory: row.raw_memory, rolloutSummary: row.rollout_summary,
    sourceRef: coverage.sourceRef, coverage,
    artifactPath: `rollout_summaries/${key}-${row.source_version}.md` };
}

export function readSuccessfulSources(database: DatabaseConnection): readonly ConsolidationSource[] {
  return database.prepare<SourceRow>({ sql: `SELECT e.* FROM memory_snapshot_sources s
    JOIN memory_extractions e ON e.session_id = s.session_id AND e.source_version = s.source_version
    WHERE s.snapshot_id = (SELECT successful_snapshot_id FROM memory_state WHERE id = 1) ORDER BY s.ordinal` }).all().map(material);
}

export function selectConsolidationSources(input: {
  database: DatabaseConnection; sources: MemorySources; configuration: MemoryConfiguration; now: number;
}): ConsolidationSelection {
  return input.database.transaction({ operation: () => {
    const state = input.database.prepare<{ dirty_revision: number; successful_snapshot_id: string | null }>({
      sql: 'SELECT dirty_revision, successful_snapshot_id FROM memory_state WHERE id = 1',
    }).get()!;
    const rows = input.database.prepare<SourceRow>({ sql: `SELECT e.* FROM memory_current_extractions c
      JOIN memory_extractions e ON e.session_id = c.session_id AND e.source_version = c.source_version
      JOIN memory_sources s ON s.session_id = e.session_id WHERE s.eligibility = 'eligible' AND length(trim(e.raw_memory)) > 0
      AND max(COALESCE(s.last_used_at,e.source_updated_at),e.source_updated_at) >= ?
      ORDER BY s.usage_count DESC, max(COALESCE(s.last_used_at,e.source_updated_at),e.source_updated_at) DESC,
        e.source_updated_at DESC,e.session_id DESC` }).all([new Date(input.now - input.configuration.maxUnusedDays * 86400000).toISOString()]);
    const selected: ConsolidationSource[] = [];
    for (const row of rows) {
      const current = input.sources.readSnapshot(row.session_id);
      if (current.status === 'failed' && current.error.code === 'STORAGE_FAILED') throw new Error('STORAGE_FAILED');
      if (current.status !== 'found' || current.snapshot.sourceVersion !== row.source_version) continue;
      selected.push(material(row));
      if (selected.length >= input.configuration.maxConsolidationSources) break;
    }
    const previous = readSuccessfulSources(input.database);
    const same = (a: ConsolidationSource, b: ConsolidationSource) => a.sessionId === b.sessionId && a.sourceVersion === b.sourceVersion;
    return { targetRevision: state.dirty_revision, selected, previous,
      added: selected.filter(source => !previous.some(old => same(source, old))),
      removed: previous.filter(old => !selected.some(source => same(source, old))),
      retained: selected.filter(source => previous.some(old => same(source, old))) };
  } });
}
