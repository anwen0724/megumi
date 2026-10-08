/*
 * Defines explicit favorite target state and stable offline pagination.
 */
import { z } from 'zod';
import { ContentCardSchema } from './feed-contracts';
export const SetFavoriteRequestSchema = z.discriminatedUnion('saved', [
  z
    .object({
      contentId: z.string().min(1),
      saved: z.literal(true),
      materialId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      contentId: z.string().min(1),
      saved: z.literal(false),
    })
    .strict(),
]);

export type SetFavoriteRequest = z.infer<typeof SetFavoriteRequestSchema>;

export const SetFavoriteResultSchema = z
  .object({
    contentId: z.string(),
    saved: z.boolean(),
    changed: z.boolean(),
  })
  .strict();

export type SetFavoriteResult = z.infer<typeof SetFavoriteResultSchema>;

export const ListFavoritesRequestSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ListFavoritesRequest = z.infer<typeof ListFavoritesRequestSchema>;

export const FavoritesViewSchema = z
  .object({
    items: z.array(ContentCardSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

export type FavoritesView = z.infer<typeof FavoritesViewSchema>;
