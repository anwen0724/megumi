/*
 * Owns the `contents` table and the rows that only exist because of one
 * content. Saving material and creating its pending analysis row happens in one
 * transaction, so a partially saved content never reaches the pools.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import {
  AnalysisStatusSchema,
  ContentTypeSchema,
  KeyPointSchema,
  LongTermValueSchema,
  type Content,
  type ContentAnalysis,
  type ContentAnalysisResult,
} from './content-contracts';

const CONTENT_SELECT = `SELECT id, source, canonical_url, title, author, published_at, text, language,
       duplicate_group_id, duplicate_confidence, created_at, updated_at FROM contents`;

/** Source facts one normalized discovery produces. */
export interface NormalizedContentInput {
  readonly id: string;
  readonly source: string;
  readonly canonicalUrl: string;
  readonly text: string;
  readonly title?: string;
  readonly author?: string;
  readonly publishedAt?: number;
  readonly language?: string;
  readonly duplicateGroupId?: string;
  readonly duplicateConfidence?: number;
}

export interface ContentStorage {
  /** Returns the existing content for a canonical URL, if any. */
  findByCanonicalUrl(canonicalUrl: string): Content | undefined;
  /** Returns one content by id, for work resumed after a restart. */
  findById(contentId: string): Content | undefined;
  /**
   * Analyses that failed and are due for another attempt, least-attempted first.
   * A failure without a retry time is terminal and never returned.
   */
  listAnalysesDueForRetry(input: {
    limit: number;
    now: number;
    maxAttempts: number;
  }): readonly string[];
  /**
   * Analyses still pending from before this round started. They are unfinished
   * work, not new work, so a round picks them up instead of leaving them stuck.
   */
  listPendingAnalyses(input: { limit: number; maxAttempts: number }): readonly string[];
  /** Records a failed analysis attempt; omitting `retryAt` makes it terminal. */
  markAnalysisFailure(input: {
    contentId: string;
    retryAt?: number;
    errorCode: string;
  }): void;
  /** Records that an attempt is starting, so the retry limit counts attempts. */
  markAnalysisRetrying(input: { contentId: string }): void;
  /** Records a discovery whose material the normalizer refused. */
  markResultRejected(input: { resultId: string; errorCode: string; now: number }): void;
  /** Records a rediscovery of stored content and links it to that content. */
  markResultReused(input: {
    resultId: string;
    contentId: string;
    url: string;
    now: number;
  }): void;
  /** Returns the first content whose normalized text is exactly equal. */
  findIdByExactText(input: { text: string; excludeId: string }): string | undefined;
  /**
   * Saves the content, its pending analysis row, and the discovery link in one
   * transaction. A later model failure never rolls this material back.
   */
  saveNormalized(input: {
    content: NormalizedContentInput;
    sourceResultId: string;
    sourceUrl: string;
    now: number;
  }): Content;
  readAnalysis(contentId: string): ContentAnalysis | undefined;
  /**
   * Records that one content duplicates another. The group representative is
   * the earliest created member, and merging points every member at it.
   */
  recordDuplicate(input: {
    contentId: string;
    duplicateOfContentId: string;
    confidence: number;
    now: number;
  }): void;
  /** Saves the eight business results and marks the text analysis ready. */
  saveAnalysisResult(input: {
    contentId: string;
    result: ContentAnalysisResult;
    now: number;
  }): void;
  /** Deletes one content and every row that depends only on it. */
  removeContent(contentId: string): void;
}

export function createContentStorage(database: DatabaseConnection): ContentStorage {
  return {
    findByCanonicalUrl(canonicalUrl) {
      const row = database
        .prepare<ContentRow>({ sql: `${CONTENT_SELECT} WHERE canonical_url = ?` })
        .get([canonicalUrl]);
      return row ? toContent(row) : undefined;
    },

    findById(contentId) {
      const row = database
        .prepare<ContentRow>({ sql: `${CONTENT_SELECT} WHERE id = ?` })
        .get([contentId]);
      return row ? toContent(row) : undefined;
    },

    listAnalysesDueForRetry(input) {
      return database
        .prepare<{ content_id: string }>({
          sql: `SELECT content_id FROM content_analysis
                WHERE status = 'failed' AND retry_at IS NOT NULL AND retry_at <= ?
                  AND attempts < ?
                ORDER BY attempts, content_id LIMIT ?`,
        })
        .all([input.now, input.maxAttempts, input.limit])
        .map((row) => row.content_id);
    },

    listPendingAnalyses(input) {
      return database
        .prepare<{ content_id: string }>({
          sql: `SELECT content_id FROM content_analysis
                WHERE status = 'pending' AND attempts < ?
                ORDER BY attempts, content_id LIMIT ?`,
        })
        .all([input.maxAttempts, input.limit])
        .map((row) => row.content_id);
    },

    markAnalysisFailure(input) {
      database
        .prepare({
          sql: `UPDATE content_analysis
                SET status = 'failed', attempts = attempts + 1, retry_at = ?, last_error_code = ?
                WHERE content_id = ?`,
        })
        .run([input.retryAt ?? null, input.errorCode, input.contentId]);
    },

    markAnalysisRetrying(input) {
      database
        .prepare({
          sql: `UPDATE content_analysis
                SET status = 'pending', attempts = attempts + 1, retry_at = NULL
                WHERE content_id = ?`,
        })
        .run([input.contentId]);
    },

    markResultRejected(input) {
      database
        .prepare({
          sql: `UPDATE search_results
                SET status = 'rejected', attempts = attempts + 1, last_error_code = ?, last_seen_at = ?
                WHERE id = ?`,
        })
        .run([input.errorCode, input.now, input.resultId]);
    },

    markResultReused(input) {
      database
        .prepare({
          sql: `UPDATE search_results
                SET status = 'normalized', content_id = ?, url = ?, attempts = attempts + 1,
                    last_error_code = NULL, last_seen_at = ?
                WHERE id = ?`,
        })
        .run([input.contentId, input.url, input.now, input.resultId]);
    },

    findIdByExactText(input) {
      const row = database
        .prepare<{ id: string }>({
          sql: 'SELECT id FROM contents WHERE text = ? AND id <> ? ORDER BY created_at, id LIMIT 1',
        })
        .get([input.text, input.excludeId]);
      return row?.id;
    },

    saveNormalized(input) {
      const content = input.content;
      database.transaction({
        operation: () => {
          database
            .prepare({
              sql: `INSERT INTO contents (id, source, canonical_url, title, author, published_at, text, language, duplicate_group_id, duplicate_confidence, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            })
            .run([
              content.id,
              content.source,
              content.canonicalUrl,
              content.title ?? null,
              content.author ?? null,
              content.publishedAt ?? null,
              content.text,
              content.language ?? null,
              content.duplicateGroupId ?? null,
              content.duplicateConfidence ?? null,
              input.now,
              input.now,
            ]);
          database
            .prepare({
              sql: "INSERT INTO content_analysis (content_id, status, attempts) VALUES (?, 'pending', 0)",
            })
            .run([content.id]);
          database
            .prepare({
              sql: "UPDATE search_results SET content_id = ?, status = 'normalized', url = ?, attempts = attempts + 1 WHERE id = ?",
            })
            .run([content.id, input.sourceUrl, input.sourceResultId]);
        },
      });
      return {
        id: content.id,
        source: content.source,
        canonicalUrl: content.canonicalUrl,
        ...(content.title ? { title: content.title } : {}),
        ...(content.author ? { author: content.author } : {}),
        ...(content.publishedAt !== undefined ? { publishedAt: content.publishedAt } : {}),
        text: content.text,
        ...(content.language ? { language: content.language } : {}),
        ...(content.duplicateGroupId ? { duplicateGroupId: content.duplicateGroupId } : {}),
        ...(content.duplicateConfidence !== undefined
          ? { duplicateConfidence: content.duplicateConfidence }
          : {}),
        createdAt: input.now,
        updatedAt: input.now,
      };
    },

    recordDuplicate(input) {
      database.transaction({
        operation: () => {
          const left = readContentRow(database, input.contentId);
          const right = readContentRow(database, input.duplicateOfContentId);
          if (!left || !right) return;
          const leftGroup = readContentRow(database, left.duplicate_group_id ?? left.id);
          const rightGroup = readContentRow(database, right.duplicate_group_id ?? right.id);
          if (!leftGroup || !rightGroup) return;

          const representative = earlierContent(leftGroup, rightGroup);
          for (const member of [leftGroup.id, rightGroup.id]) {
            database
              .prepare({
                sql: `UPDATE contents
                      SET duplicate_group_id = ?, duplicate_confidence = ?, updated_at = ?
                      WHERE id <> ? AND (id = ? OR duplicate_group_id = ?)`,
              })
              .run([
                representative.id,
                input.confidence,
                input.now,
                representative.id,
                member,
                member,
              ]);
          }
        },
      });
    },

    readAnalysis(contentId) {
      const row = database
        .prepare<AnalysisRow>({ sql: 'SELECT * FROM content_analysis WHERE content_id = ?' })
        .get([contentId]);
      return row ? toAnalysis(row) : undefined;
    },

    saveAnalysisResult(input) {
      const result = input.result;
      database
        .prepare({
          sql: `UPDATE content_analysis
                SET summary = ?, key_points = ?, topics = ?, entities = ?, content_type = ?,
                    quality_score = ?, spam_score = ?, long_term_value = ?, status = 'ready',
                    analyzed_at = ?, last_error_code = NULL, retry_at = NULL
                WHERE content_id = ?`,
        })
        .run([
          result.summary,
          JSON.stringify(result.keyPoints),
          JSON.stringify(result.topics),
          JSON.stringify(result.entities),
          result.contentType,
          result.qualityScore,
          result.spamScore,
          result.longTermValue,
          input.now,
          input.contentId,
        ]);
    },

    removeContent(contentId) {
      database.transaction({
        operation: () => {
          database
            .prepare({ sql: 'DELETE FROM search_results WHERE content_id = ? AND status = ?' })
            .run([contentId, 'normalized']);
          database.prepare({ sql: 'DELETE FROM contents WHERE id = ?' }).run([contentId]);
        },
      });
    },
  };
}

interface ContentRow extends DatabaseRow {
  readonly id: string;
  readonly source: string;
  readonly canonical_url: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly published_at: number | null;
  readonly text: string;
  readonly language: string | null;
  readonly duplicate_group_id: string | null;
  readonly duplicate_confidence: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface AnalysisRow extends DatabaseRow {
  readonly content_id: string;
  readonly summary: string | null;
  readonly key_points: string | null;
  readonly topics: string | null;
  readonly entities: string | null;
  readonly content_type: string | null;
  readonly quality_score: number | null;
  readonly spam_score: number | null;
  readonly long_term_value: string | null;
  readonly embedding: string | null;
  readonly embedding_model: string | null;
  readonly status: string;
  readonly attempts: number;
  readonly retry_at: number | null;
  readonly last_error_code: string | null;
  readonly analyzed_at: number | null;
  readonly embedding_retry_at: number | null;
  readonly embedding_error_code: string | null;
}

function readContentRow(database: DatabaseConnection, id: string): ContentRow | undefined {
  return database.prepare<ContentRow>({ sql: `${CONTENT_SELECT} WHERE id = ?` }).get([id]);
}

/** The representative is the earliest created member; equal times fall back to the id. */
function earlierContent(left: ContentRow, right: ContentRow): ContentRow {
  if (left.created_at !== right.created_at) return left.created_at < right.created_at ? left : right;
  return left.id <= right.id ? left : right;
}

function toContent(row: ContentRow): Content {
  return {
    id: row.id,
    source: row.source,
    canonicalUrl: row.canonical_url,
    ...(row.title ? { title: row.title } : {}),
    ...(row.author ? { author: row.author } : {}),
    ...(row.published_at !== null ? { publishedAt: row.published_at } : {}),
    text: row.text,
    ...(row.language ? { language: row.language } : {}),
    ...(row.duplicate_group_id ? { duplicateGroupId: row.duplicate_group_id } : {}),
    ...(row.duplicate_confidence !== null ? { duplicateConfidence: row.duplicate_confidence } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** JSON and enum columns are validated once here, at the storage boundary. */
function toAnalysis(row: AnalysisRow): ContentAnalysis {
  return {
    contentId: row.content_id,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.key_points ? { keyPoints: parseColumn(row.key_points, z.array(KeyPointSchema)) } : {}),
    ...(row.topics ? { topics: parseColumn(row.topics, z.array(z.string().min(1))) } : {}),
    ...(row.entities ? { entities: parseColumn(row.entities, z.array(z.string().min(1))) } : {}),
    ...(row.content_type ? { contentType: ContentTypeSchema.parse(row.content_type) } : {}),
    ...(row.quality_score !== null ? { qualityScore: row.quality_score } : {}),
    ...(row.spam_score !== null ? { spamScore: row.spam_score } : {}),
    ...(row.long_term_value ? { longTermValue: LongTermValueSchema.parse(row.long_term_value) } : {}),
    ...(row.embedding ? { embedding: parseColumn(row.embedding, z.array(z.number())) } : {}),
    ...(row.embedding_model ? { embeddingModel: row.embedding_model } : {}),
    status: AnalysisStatusSchema.parse(row.status),
    attempts: row.attempts,
    ...(row.retry_at !== null ? { retryAt: row.retry_at } : {}),
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.analyzed_at !== null ? { analyzedAt: row.analyzed_at } : {}),
    ...(row.embedding_retry_at !== null ? { embeddingRetryAt: row.embedding_retry_at } : {}),
    ...(row.embedding_error_code ? { embeddingErrorCode: row.embedding_error_code } : {}),
  };
}

function parseColumn<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value));
}
