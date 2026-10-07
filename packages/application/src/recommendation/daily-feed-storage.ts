/*
 * Owns daily batches and result references, preserving published items across retries.
 */
import type { DatabaseConnection, DatabaseRow } from '../storage/index';
import type { InterestSnapshotEntry } from './interests/interest-contracts';
import type { createMaterialStorage } from './content/material-storage';
import type { ContentMaterial } from './content/material-contracts';
import { z } from 'zod';
import { DailyFeedViewSchema, type ContentCard } from './feed-contracts';
import { DailyFeedBatchRecordSchema } from './recommendation-records';
import { RecommendationIssueSchema, type DiscoveryRunRecord } from './discovery/discovery-records';
import type { DiscoveryIssue } from './discovery/discovery-storage';
import { publicationInterval, shiftDate } from './daily-calendar';
interface BatchRow extends DatabaseRow {
  id: string;
  date: string;
  timezone: string;
  interest_id: string;
  interest_revision: number;
  interest_text: string;
  window_start: number;
  window_end: number;
  status: string;
  committed_at: number;
  issues: string;
}
/** Shares the transaction with the Interest owner when committing each batch. */
export function createDailyFeedStorage(input: {
  database: DatabaseConnection;
  materials: ReturnType<typeof createMaterialStorage>;
  interests(): readonly InterestSnapshotEntry[];
  newId(prefix: string): string;
  now(): number;
}) {
  const { database } = input;
  const readBatch = (row: BatchRow) => DailyFeedBatchRecordSchema.parse({ id: row.id, date: row.date, timezone: row.timezone, interestId: row.interest_id, interestRevision: row.interest_revision, interestText: row.interest_text, windowStart: row.window_start, windowEnd: row.window_end, status: row.status, committedAt: row.committed_at, issues: JSON.parse(row.issues) });
  const storage = {
    attempts(date: string, interest: InterestSnapshotEntry) {
      return database.prepare<{
        failures: number;
        last_finished_at: number | null;
      }>({ sql: `SELECT count(*) AS failures,max(finished_at) AS last_finished_at FROM recommendation_runs r WHERE r.kind='daily_feed' AND (r.status='failed' OR EXISTS(SELECT 1 FROM json_each(r.outcome,'$.batchStatuses') b WHERE b.key=? AND b.value='failed')) AND json_extract(r.outcome,'$.date')=? AND EXISTS (SELECT 1 FROM json_each(r.interest_snapshot) i WHERE json_extract(i.value,'$.id')=? AND json_extract(i.value,'$.revision')=?)` }).get([interest.id, date, interest.id, interest.revision])!;
    },
    batch(date: string, interest: InterestSnapshotEntry) { const row = database.prepare<BatchRow>({ sql: 'SELECT * FROM daily_feed_batches WHERE date=? AND interest_id=? AND interest_revision=?' }).get([date, interest.id, interest.revision]); return row ? readBatch(row) : undefined; },
    seenBefore(contentId: string, date: string): boolean { return Boolean(database.prepare({ sql: 'SELECT 1 FROM daily_feed_items i JOIN daily_feed_batches b ON b.id=i.batch_id WHERE i.content_id=? AND b.date>=? AND b.date<? LIMIT 1' }).get([contentId, shiftDate(date, -6), date])); },
    commit(request: {
      date: string;
      timezone: string;
      interest: InterestSnapshotEntry;
      window: {
        start: number;
        end: number;
      };
      items: readonly ContentMaterial[];
      issues: readonly DiscoveryIssue[];
      limit: number;
    }) {
      return database.transaction({
        operation: () => {
          database.prepare({ sql: 'INSERT OR IGNORE INTO recommendation_state(id) VALUES(1)' }).run();
          const current = input.interests().find(interest => interest.id === request.interest.id && interest.enabled && interest.revision === request.interest.revision);
          if (!current)
            return undefined;
          const previous = storage.batch(request.date, request.interest);
          const id = previous?.id ?? input.newId('daily_batch');
          const status = request.items.length || previous && ['ready', 'partial'].includes(previous.status) ? request.issues.length ? 'partial' : 'ready' : request.issues.length ? 'failed' : 'empty';
          database.prepare({ sql: `INSERT INTO daily_feed_batches(id,date,timezone,interest_id,interest_revision,interest_text,window_start,window_end,status,committed_at,issues) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(date,interest_id,interest_revision) DO UPDATE SET status=excluded.status,committed_at=excluded.committed_at,issues=excluded.issues` }).run([id, request.date, request.timezone, request.interest.id, request.interest.revision, request.interest.text, request.window.start, request.window.end, status, input.now(), JSON.stringify(request.issues)]);
          const existing = database.prepare<{
            content_id: string;
          }>({ sql: 'SELECT content_id FROM daily_feed_items WHERE batch_id=? ORDER BY display_order' }).all([id]);
          const saved = new Set(existing.map(item => item.content_id));
          let order = existing.length;
          for (const material of [...request.items].sort((a, b) => (publicationInterval(b)?.start ?? 0) - (publicationInterval(a)?.start ?? 0) || a.contentId.localeCompare(b.contentId))) {
            if (saved.has(material.contentId) || order >= request.limit || storage.seenBefore(material.contentId, request.date))
              continue;
            database.prepare({ sql: 'INSERT INTO daily_feed_items(batch_id,content_id,material_id,display_order,title_snapshot,summary_snapshot,publication_snapshot) VALUES(?,?,?,?,?,?,?)' }).run([id, material.contentId, material.id, order++, material.title ?? material.canonicalUrl, [...material.text].slice(0, 500).join(''), JSON.stringify(material.publicationEvidence)]);
            saved.add(material.contentId);
          }
          return id;
        }
      });
    },
    list(date: string, limit: number) {
      const batches = database.prepare<BatchRow>({ sql: 'SELECT * FROM daily_feed_batches WHERE date=? ORDER BY committed_at,id' }).all([date]).map(readBatch);
      const current = input.interests();
      const cards = new Map<string, ContentCard>();
      const lists: ContentCard[][] = [];
      for (const batch of batches) {
        const items = database.prepare<{
          content_id: string;
          material_id: string;
          title_snapshot: string;
          summary_snapshot: string;
        }>({ sql: 'SELECT * FROM daily_feed_items WHERE batch_id=? ORDER BY display_order' }).all([batch.id]);
        const list: ContentCard[] = [];
        for (const row of items) {
          const material = input.materials.readMaterial(row.material_id)!;
          let card = cards.get(row.content_id);
          if (!card) {
            const publication = publicationInterval(material);
            card = { contentId: row.content_id, materialId: row.material_id, platform: material.platform, title: row.title_snapshot, url: material.canonicalUrl, author: material.author, excerpt: row.summary_snapshot, materialKind: material.kind, truncated: material.truncated, publicationPrecision: publication?.precision ?? 'unknown', ...(publication ? { publishedAt: publication.precision === 'date' ? String(publication.evidence.value) : new Date(publication.start).toISOString() } : {}), interestLabels: [], saved: Boolean(database.prepare({ sql: 'SELECT 1 FROM favorites WHERE content_id=?' }).get([row.content_id])) };
            cards.set(row.content_id, card);
          }
          card.interestLabels.push({ interestId: batch.interestId, revision: batch.interestRevision, text: batch.interestText, historical: !current.some(interest => interest.id === batch.interestId && interest.revision === batch.interestRevision && interest.enabled) });
          list.push(card);
        }
        lists.push(list.sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0) || a.contentId.localeCompare(b.contentId)));
      }
      const chosen = new Map<string, ContentCard>();
      for (let position = 0; chosen.size < limit && lists.some(list => position < list.length); position++)
        for (const list of lists) {
          const card = list[position];
          if (card && chosen.size < limit)
            chosen.set(card.contentId, card);
        }
      const activeRuns = database.prepare<{
        id: string;
      }>({ sql: "SELECT id FROM recommendation_runs WHERE kind='daily_feed' AND status IN ('queued','running') AND json_extract(outcome,'$.date')=?" }).all([date]).map(row => row.id);
      return DailyFeedViewSchema.parse({ date, items: [...chosen.values()].sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0) || a.contentId.localeCompare(b.contentId)), batches: batches.map(batch => ({ id: batch.id, interestId: batch.interestId, interestRevision: batch.interestRevision, interestText: batch.interestText, status: batch.status, issues: batch.issues, committedAt: new Date(batch.committedAt).toISOString(), windowStart: new Date(batch.windowStart).toISOString(), windowEnd: new Date(batch.windowEnd).toISOString() })), activeRuns });
    }
  };
  return storage;
}
export type DailyFeedStorage = ReturnType<typeof createDailyFeedStorage>;
