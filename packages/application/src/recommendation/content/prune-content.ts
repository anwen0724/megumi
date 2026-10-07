/*
 * Removes content that no business purpose keeps any more. Retention belongs to
 * the referencing modules: a failing query rejects instead of reading as "no
 * references", and unfinished work or a referenced duplicate representative is
 * never deleted.
 */
import type { DatabaseConnection } from '../../storage/index';
import type { CandidateStorage } from '../candidates/candidate-storage';
import type { ContentStorage } from '../content/content-storage';
import type { ContentRetentionReader } from '../supply/supply-contracts';

export interface PruneDependencies {
  readonly database: DatabaseConnection;
  readonly contents: ContentStorage;
  readonly candidates: CandidateStorage;
  readonly retention: ContentRetentionReader;
}

export interface PruneInput {
  readonly batchSize: number;
}

export interface PruneOutcome {
  readonly examined: number;
  readonly removedContents: number;
  readonly retainedContents: number;
}

/**
 * Deletes content whose analysis finished, that holds no active pool relation,
 * that no other content duplicates, and that no business record still needs.
 * Only a finished analysis is reclaimable: a pending analysis and a failure that
 * still has retries left are unfinished work, so they stay. Search history and
 * referencing-module records are left untouched.
 */
export async function pruneUnusedContent(
  dependencies: PruneDependencies,
  input: PruneInput,
): Promise<PruneOutcome> {
  const ids = dependencies.database
    .prepare<{ id: string }>({
      sql: `SELECT c.id FROM contents c
            JOIN content_analysis ca ON ca.content_id = c.id
            WHERE ca.status = 'ready'
              AND NOT EXISTS (
                SELECT 1 FROM recommendation_candidates rc
                WHERE rc.content_id = c.id AND rc.status = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM contents member WHERE member.duplicate_group_id = c.id
              )
            ORDER BY c.created_at, c.id
            LIMIT ?`,
    })
    .all([input.batchSize])
    .map((row) => row.id);
  if (ids.length === 0) return { examined: 0, removedContents: 0, retainedContents: 0 };

  const pending = new Set(dependencies.candidates.filterPendingMatchContentIds(ids));
  const retained = new Set(await dependencies.retention.findRetainedContentIds(ids));
  let removedContents = 0;
  for (const id of ids) {
    if (pending.has(id) || retained.has(id)) continue;
    dependencies.contents.removeContent(id);
    removedContents += 1;
  }
  return {
    examined: ids.length,
    removedContents,
    retainedContents: ids.length - removedContents,
  };
}
