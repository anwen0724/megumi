/*
 * Owns explicit favorite relationships, pinned versions and cursor pagination.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '../storage/index';
import type { createMaterialStorage } from './content/material-storage';
import { contentCard } from './content-card';
import { ListFavoritesRequestSchema, SetFavoriteRequestSchema, type SetFavoriteRequest, type ListFavoritesRequest } from './favorite-contracts';
interface FavoriteRow extends DatabaseRow {
  content_id: string;
  material_id: string;
  title_snapshot: string;
  created_at: number;
}
const CursorSchema = z.object({ createdAt: z.number().int().nonnegative(), contentId: z.string().min(1) }).strict();
const invalid = () => Object.assign(new Error('The favorite request is invalid.'), { code: 'INVALID_REQUEST' });
/** A repeated save retains the first displayed version and never becomes a preference signal. */
export function createFavoriteStorage(input: {
  database: DatabaseConnection;
  materials: ReturnType<typeof createMaterialStorage>;
  now(): number;
}) {
  const { database } = input;
  return {
    /** Pins the displayed version under the same write lock as the favorite relationship. */
    set(request: SetFavoriteRequest) {
      const parsed = SetFavoriteRequestSchema.safeParse(request);
      if (!parsed.success)
        throw invalid();
      return database.transaction({
        operation: () => {
          if (!request.saved) {
            const changed = database.prepare({ sql: 'DELETE FROM favorites WHERE content_id=?' }).run([request.contentId]).changes > 0;
            return { contentId: request.contentId, saved: false, changed };
          }
          database.prepare({ sql: 'UPDATE favorites SET content_id=content_id WHERE content_id=?' }).run([request.contentId]);
          const material = input.materials.readMaterial(request.materialId);
          if (!material)
            throw Object.assign(new Error('The requested material no longer exists.'), { code: 'CONTENT_NOT_FOUND' });
          if (material.contentId !== request.contentId)
            throw invalid();
          const changed = database.prepare({ sql: 'INSERT OR IGNORE INTO favorites(content_id,material_id,title_snapshot,created_at) VALUES(?,?,?,?)' }).run([request.contentId, request.materialId, material.title ?? material.canonicalUrl, input.now()]).changes > 0;
          return { contentId: request.contentId, saved: true, changed };
        }
      });
    },
    /** Reads only pinned local materials; the cursor preserves creation-time/content-ID order. */
    list(request: ListFavoritesRequest = {}) {
      const parsed = ListFavoritesRequestSchema.safeParse(request);
      if (!parsed.success)
        throw invalid();
      let cursor: z.infer<typeof CursorSchema> | undefined;
      if (request.cursor) {
        try {
          cursor = CursorSchema.parse(JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')));
        }
        catch {
          throw invalid();
        }
      }
      const limit = request.limit ?? 30;
      const rows = database.prepare<FavoriteRow>({ sql: `SELECT * FROM favorites ${cursor ? 'WHERE created_at<? OR (created_at=? AND content_id<?)' : ''} ORDER BY created_at DESC,content_id DESC LIMIT ?` }).all(cursor ? [cursor.createdAt, cursor.createdAt, cursor.contentId, limit + 1] : [limit + 1]);
      const items = rows.slice(0, limit).map(row => contentCard(input.materials.readMaterial(row.material_id)!, { title: row.title_snapshot, saved: true, interestLabels: [] }));
      const last = rows[limit - 1];
      return { items, ...(rows.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({ createdAt: last.created_at, contentId: last.content_id })).toString('base64url') } : {}) };
    },
    /** Exposes retained references to Content without allowing it to read result-owner tables. */
    references() {
      return database.prepare<{
        content_id: string;
        material_id: string;
      }>({ sql: 'SELECT content_id,material_id FROM favorites' }).all();
    },
  };
}
