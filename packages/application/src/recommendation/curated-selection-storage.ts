/*
 * Owns curated history and atomically publishes the actual surviving candidate inputs.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '../storage/index';
import type { InterestSnapshotEntry } from './interests/interest-contracts';
import { InterestSnapshotEntrySchema } from './interests/interest-contracts';
import { interestSetHash } from './interests/interest-set';
import type { CandidateQualificationStorage } from './candidates/candidate-qualification-storage';
import type { createMaterialStorage } from './content/material-storage';
import { validateEvidence } from './content/material-storage';
import { CuratedSelectionSchema, type SelectionItem } from './curated-contracts';
import type { RecommendationRunStorage } from './recommendation-run-storage';
import type { DiscoveryIssue } from './discovery/discovery-storage';
import { publicationInterval } from './daily-calendar';

export type CuratedInput = ReturnType<CandidateQualificationStorage['listCandidates']>[number];

interface SelectionRow extends DatabaseRow {
  id: string;
  interest_snapshot: string;
  created_at: number;
}

/** Shares the result transaction with candidate eligibility and authoritative interest reads. */
export function createCuratedSelectionStorage(input: {
  database: DatabaseConnection;
  materials: ReturnType<typeof createMaterialStorage>;
  candidates: CandidateQualificationStorage;
  interests(): readonly InterestSnapshotEntry[];
  now(): number;
  newId(prefix: string): string;
  runs: RecommendationRunStorage;
}) {
  const { database } = input;
  const currentInterests = () =>
    input.interests().map(({ id, text, enabled, revision }) => ({
      id,
      text,
      enabled,
      revision,
    }));
  const storage = {
    /** Creates a run, freezes eligible inputs and records rotation facts in one shared transaction. */
    freezeInputs(request: {
      id: string;
      requestId: string;
      interestHash: string;
      interests: readonly InterestSnapshotEntry[];
      automatic: boolean;
      select(now: number): CuratedInput[];
    }) {
      return database.transaction({
        operation: () => {
          database
            .prepare({ sql: 'INSERT OR IGNORE INTO recommendation_state(id) VALUES(1)' })
            .run();
          const now = input.now();
          input.runs.create({
            id: request.id,
            kind: 'curated',
            requestId: request.requestId,
            inputHash: request.interestHash,
            interests: request.interests,
            now,
            outcome: { automatic: request.automatic },
          });
          if (interestSetHash(currentInterests()) !== request.interestHash) {
            input.runs.finish(request.id, 'superseded', now, [
              {
                code: 'INPUT_CHANGED',
                message: 'The authoritative interest set changed before freezing.',
              },
            ]);
            return undefined;
          }

          const candidates = request.select(now);
          input.runs.freeze(
            request.id,
            candidates.map((candidate, originalOrder) => ({
              contentId: candidate.contentId,
              materialId: candidate.materialId,
              analysisContractVersion: 2,
              matchingContractVersion: 2,
              interests: candidate.qualifications.map(pair => ({
                interestId: pair.interestId,
                revision: pair.interestRevision,
              })),
              originalOrder,
            })),
          );
          input.candidates.recordSelectionInputs(request.id, candidates, now);

          return candidates;
        },
      });
    },

    /** Reads durable automatic selection progress without starting external work. */
    automaticState() {
      return database
        .prepare<{
          pending_initial_interest_hash: string | null;
          finished_automatic_interest_hash: string | null;
          automatic_retry_count: number;
          next_retry_at: number | null;
        }>({ sql: 'SELECT * FROM recommendation_state WHERE id=1' })
        .get();
    },

    /** A new authoritative interest set resets attempts; empty inventory does not consume them. */
    waitForInterestSet(hash: string) {
      database.prepare({ sql: 'INSERT OR IGNORE INTO recommendation_state(id) VALUES(1)' }).run();
      database
        .prepare({
          sql: 'UPDATE recommendation_state SET pending_initial_interest_hash=?,automatic_retry_count=0,next_retry_at=NULL WHERE id=1 AND (pending_initial_interest_hash IS NULL OR pending_initial_interest_hash<>?)',
        })
        .run([hash, hash]);
    },

    /** Reserves one automatic attempt before returning run acceptance. */
    beginAutomatic(hash: string) {
      storage.waitForInterestSet(hash);
      database
        .prepare({
          sql: 'UPDATE recommendation_state SET automatic_retry_count=automatic_retry_count+1,next_retry_at=NULL WHERE id=1 AND pending_initial_interest_hash=?',
        })
        .run([hash]);
      return storage.automaticState()!.automatic_retry_count;
    },

    /** Old or superseded runs cannot alter the current set's retry state. */
    finishAutomatic(hash: string, status: string, now: number) {
      if (['completed', 'partial'].includes(status))
        database
          .prepare({
            sql: 'UPDATE recommendation_state SET pending_initial_interest_hash=NULL,finished_automatic_interest_hash=?,next_retry_at=NULL WHERE id=1 AND pending_initial_interest_hash=?',
          })
          .run([hash, hash]);
      else if (status === 'failed' || status === 'interrupted')
        database
          .prepare({
            sql: 'UPDATE recommendation_state SET next_retry_at=? WHERE id=1 AND pending_initial_interest_hash=?',
          })
          .run([now + 300000, hash]);
    },

    /** Returns the persisted current batch even if its candidates are no longer eligible. */
    current() {
      const row = database
        .prepare<SelectionRow>({
          sql: 'SELECT s.* FROM curated_selections s JOIN recommendation_state r ON r.current_selection_id=s.id WHERE r.id=1',
        })
        .get();
      if (!row) return undefined;

      const interests = currentInterests();
      const items = database
        .prepare<{
          content_id: string;
          material_id: string;
          reason: string;
          evidence: string;
          matched_interests: string;
        }>({
          sql: 'SELECT * FROM curated_selection_items WHERE selection_id=? ORDER BY display_order',
        })
        .all([row.id]);

      return {
        interestHash: interestSetHash(
          z.array(InterestSnapshotEntrySchema).parse(JSON.parse(row.interest_snapshot)),
        ),
        selection: CuratedSelectionSchema.parse({
          id: row.id,
          createdAt: new Date(row.created_at).toISOString(),
          items: items.map(item => {
            const material = input.materials.readMaterial(item.material_id)!;
            const date = publicationInterval(material);
            const labels = z
              .array(InterestSnapshotEntrySchema)
              .parse(JSON.parse(item.matched_interests));

            return {
              contentId: item.content_id,
              materialId: material.id,
              platform: material.platform,
              title: material.title ?? material.canonicalUrl,
              url: material.canonicalUrl,
              author: material.author,
              excerpt: [...material.text].slice(0, 500).join(''),
              materialKind: material.kind,
              truncated: material.truncated,
              publicationPrecision: date?.precision ?? 'unknown',
              ...(date
                ? {
                    publishedAt:
                      date.precision === 'date'
                        ? String(date.evidence.value)
                        : new Date(date.start).toISOString(),
                  }
                : {}),
              interestLabels: labels.map(label => ({
                interestId: label.id,
                revision: label.revision,
                text: label.text,
                historical: !interests.some(
                  current =>
                    current.id === label.id &&
                    current.revision === label.revision &&
                    current.enabled,
                ),
              })),
              saved: Boolean(
                database
                  .prepare({ sql: 'SELECT 1 FROM favorites WHERE content_id=?' })
                  .get([item.content_id]),
              ),
              reason: item.reason,
              evidence: JSON.parse(item.evidence),
            };
          }),
        }),
      };
    },

    /** Acquires the SQLite write lock before reading time or checking current qualification. */
    publish(request: {
      runId: string;
      interestHash: string;
      inputs: readonly CuratedInput[];
      selected: readonly SelectionItem[];
      targetCount: number;
      contentLanguages: readonly string[];
      issues: readonly DiscoveryIssue[];
    }) {
      return database.transaction({
        operation: () => {
          database
            .prepare({ sql: 'INSERT OR IGNORE INTO recommendation_state(id) VALUES(1)' })
            .run();
          const now = input.now();
          const interests = currentInterests().filter(item => item.enabled);
          if (!['queued', 'running'].includes(input.runs.read(request.runId)?.status ?? ''))
            return {
              status: 'cancelled' as const,
              issues: [...request.issues],
            };
          if (interestSetHash(interests) !== request.interestHash) {
            input.runs.finish(request.runId, 'superseded', now, request.issues);
            return {
              status: 'superseded' as const,
              issues: [...request.issues],
            };
          }

          const eligible = input.candidates.listEligible(now, {
            contentLanguages: request.contentLanguages,
          });
          const selected = request.selected.flatMap(item => {
            const frozen = request.inputs.find(
              candidate => candidate.contentId === item.contentId,
            )!;
            const matches = item.matchedInterestIds.filter(id =>
              eligible.some(
                pair =>
                  pair.contentId === item.contentId &&
                  pair.materialId === frozen.materialId &&
                  pair.interestId === id &&
                  frozen.qualifications.some(
                    old => old.interestId === id && old.interestRevision === pair.interestRevision,
                  ),
              ),
            );
            if (!matches.length) return [];

            validateEvidence(frozen.material, item.evidence);

            return [
              {
                ...item,
                materialId: frozen.materialId,
                labels: interests.filter(interest => matches.includes(interest.id)),
              },
            ];
          });
          const issues = [...request.issues];
          const groups = selected.map(item => input.candidates.duplicateGroup(item.contentId));
          if (new Set(groups).size !== groups.length) {
            issues.push({
              code: 'INPUT_CHANGED',
              message: 'Duplicate grouping changed before publication.',
            });
            input.runs.finish(request.runId, 'failed', now, issues);
            return {
              status: 'no_change' as const,
              issues,
            };
          }
          if (selected.length < request.selected.length)
            issues.push({
              code: 'INPUT_CHANGED',
              message: 'Some frozen candidates became ineligible before publication.',
            });
          if (!selected.length) {
            input.runs.finish(request.runId, 'completed', now, issues, undefined, {
              result: 'no_change',
            });
            return {
              status: 'no_change' as const,
              issues,
            };
          }

          const id = input.newId('curated');
          database
            .prepare({
              sql: "UPDATE curated_selections SET status='retired' WHERE id=(SELECT current_selection_id FROM recommendation_state WHERE id=1)",
            })
            .run();
          database
            .prepare({
              sql: "INSERT INTO curated_selections(id,interest_snapshot,created_at,status) VALUES(?,?,?,'ready')",
            })
            .run([id, JSON.stringify(interests), now]);
          for (const [order, item] of selected.entries())
            database
              .prepare({
                sql: 'INSERT INTO curated_selection_items(selection_id,content_id,material_id,display_order,matched_interests,reason,evidence) VALUES(?,?,?,?,?,?,?)',
              })
              .run([
                id,
                item.contentId,
                item.materialId,
                order,
                JSON.stringify(item.labels),
                item.reason,
                JSON.stringify(item.evidence),
              ]);

          database
            .prepare({
              sql: 'UPDATE recommendation_state SET current_selection_id=?,pending_initial_interest_hash=NULL,finished_automatic_interest_hash=?,next_retry_at=NULL WHERE id=1',
            })
            .run([id, request.interestHash]);

          const status =
            selected.length < request.targetCount || issues.length
              ? ('partial' as const)
              : ('completed' as const);
          if (selected.length < request.targetCount)
            issues.push({
              code: 'INSUFFICIENT_CANDIDATES',
              message: 'The committed selection contains fewer items than the requested target.',
            });

          input.runs.finish(request.runId, status, now, issues, id, {
            committedContentIds: selected.map(item => item.contentId),
          });

          return {
            status,
            selectionId: id,
            issues,
          };
        },
      });
    },
  };

  return storage;
}

export type CuratedSelectionStorage = ReturnType<typeof createCuratedSelectionStorage>;
