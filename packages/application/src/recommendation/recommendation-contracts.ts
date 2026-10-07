/*
 * Defines the renderer-safe Recommendation Host and validated product operations.
 */
import { z } from 'zod';
import { RecommendationConfigurationSchema } from '../settings/definitions/recommendation';
import { ModelReferenceSchema } from '../settings/definitions/providers';
import { InterestSnapshotEntrySchema, CreateInterestRequestSchema, UpdateInterestRequestSchema, DeleteInterestRequestSchema } from './interests/interest-contracts';
import type { CreateInterestRequest, UpdateInterestRequest, DeleteInterestRequest } from './interests/interest-contracts';
import type { DailyFeedView, StartDailyFeedResult, RecommendationRunView, RecommendationChanged } from './feed-contracts';
import type { CuratedSelectionView, StartCuratedSelectionResult } from './curated-contracts';
import type { SetFavoriteRequest, SetFavoriteResult, ListFavoritesRequest, FavoritesView } from './favorite-contracts';
import { SourceAccessViewSchema, SourceIdSchema, type SourceAccessView, type SourceLoginResult } from './sources/source-access-contracts';
export * from './feed-contracts';
export * from './curated-contracts';
export * from './favorite-contracts';
export { CreateInterestRequestSchema, UpdateInterestRequestSchema, DeleteInterestRequestSchema };
export { SourceAccessViewSchema, SourceLoginResultSchema, type SourceAccessView, type SourceLoginResult } from './sources/source-access-contracts';

export const RecommendationEmptyRequestSchema = z.object({}).strict();
export type RecommendationEmptyRequest = z.infer<typeof RecommendationEmptyRequestSchema>;
export const SourceAccessRequestSchema = z.object({ sourceId: SourceIdSchema }).strict();
export type SourceAccessRequest = z.infer<typeof SourceAccessRequestSchema>;
export const InterestUiSchema = InterestSnapshotEntrySchema;
export type InterestUi = z.infer<typeof InterestUiSchema>;
export const InterestListResultSchema = z.object({ interests: z.array(InterestUiSchema) }).strict();
export type InterestListResult = z.infer<typeof InterestListResultSchema>;
export const CreateInterestResultSchema = z.object({ status: z.literal('created'), interest: InterestUiSchema }).strict();
export const UpdateInterestResultSchema = z.object({ status: z.enum(['updated', 'unchanged']), interest: InterestUiSchema }).strict();
export const DeleteInterestResultSchema = z.object({ status: z.enum(['deleted', 'already_deleted']) }).strict();
export const SupplySourceViewSchema = SourceAccessViewSchema.extend({
  name: z.string().min(1), enabled: z.boolean(), credentialConfigured: z.boolean(),
}).strict();
export type SupplySourceView = z.infer<typeof SupplySourceViewSchema>;
export const RecommendationConfigurationViewSchema = z.object({
  revision: z.string().min(1), config: RecommendationConfigurationSchema, sources: z.array(SupplySourceViewSchema),
}).strict();
export type RecommendationConfigurationView = z.infer<typeof RecommendationConfigurationViewSchema>;
export const RecommendationChangesSchema = z.object({
  enabled: z.boolean().optional(),
  enabledSources: RecommendationConfigurationSchema.shape.enabledSources.removeDefault().optional(),
  candidateSupplyModel: ModelReferenceSchema.nullable().optional(),
  recommendationModel: ModelReferenceSchema.nullable().optional(),
  dailyFeed: RecommendationConfigurationSchema.shape.dailyFeed.removeDefault().innerType().partial().optional(),
  candidateSupply: RecommendationConfigurationSchema.shape.candidateSupply.removeDefault().innerType().partial().optional(),
  curated: RecommendationConfigurationSchema.shape.curated.removeDefault().innerType().partial().optional(),
  limits: RecommendationConfigurationSchema.shape.limits.removeDefault().innerType().partial().optional(),
}).strict();
export const RecommendationConfigurationUpdateSchema = z.object({
  expectedRevision: z.string().min(1), changes: RecommendationChangesSchema,
}).strict();
export type RecommendationConfigurationUpdate = z.infer<typeof RecommendationConfigurationUpdateSchema>;
export const OpenContentRequestSchema = z.object({ contentId: z.string().min(1) }).strict();
export const OpenContentResultSchema = z.object({ status: z.literal('accepted') }).strict();

/** All result reads are local; start operations return acceptance before external execution. */
export interface RecommendationHost {
  /** Reads authoritative original interests and their current revisions. */
  listInterests(): Promise<InterestListResult>;
  /** Saves original text locally; invalid text raises INVALID_REQUEST. */
  createInterest(request: CreateInterestRequest): Promise<z.infer<typeof CreateInterestResultSchema>>;
  /** Checks the expected revision before applying a text or enable change. */
  updateInterest(request: UpdateInterestRequest): Promise<z.infer<typeof UpdateInterestResultSchema>>;
  /** Deletes only the interest; historical results and favorites remain readable. */
  deleteInterest(request: DeleteInterestRequest): Promise<z.infer<typeof DeleteInterestResultSchema>>;
  /** Reads saved daily batches without acquiring sources or evaluating material. */
  listDailyFeed(request: { date?: string }): Promise<DailyFeedView>;
  /** Returns saved selection, demand changes and local supply status. */
  getCuratedSelection(): Promise<CuratedSelectionView>;
  /** Reads pinned favorites with stable descending pagination. */
  listFavorites(request: ListFavoritesRequest): Promise<FavoritesView>;
  /** Commits the explicit favorite target state, retaining its first displayed material. */
  setFavorite(request: SetFavoriteRequest): Promise<SetFavoriteResult>;
  /** Accepts today's unfinished acquisition and returns its persisted run reference. */
  startDailyFeed(request: { requestId: string; interestIds?: readonly string[] }): Promise<StartDailyFeedResult>;
  /** Selects saved candidates; shortage registers independent supply without awaiting it. */
  startCuratedSelection(request: { requestId: string }): Promise<StartCuratedSelectionResult>;
  /** Reads the run from its owning module; no polling has external side effects. */
  getRun(request: { runId: string }): Promise<RecommendationRunView | undefined>;
  /** Accepts cancellation of the named run, without claiming external work already stopped. */
  cancelRun(request: { runId: string }): Promise<{ status: 'cancelling' | 'already_finished' | 'not_found' }>;
  /** Reads non-sensitive configuration and cached source access. */
  getConfiguration(): Promise<RecommendationConfigurationView>;
  /** Applies a Settings patch against the caller's configuration revision. */
  updateConfiguration(request: RecommendationConfigurationUpdate): Promise<RecommendationConfigurationView>;
  /** Opens the platform's isolated login window; opening does not prove login success. */
  openSourceLogin(request: SourceAccessRequest): Promise<SourceLoginResult>;
  /** Makes one explicit bounded source access probe. */
  checkSourceAccess(request: SourceAccessRequest): Promise<SourceAccessView>;
  /** Opens the URL owned by saved content, never a renderer-supplied arbitrary URL. */
  openContent(request: { contentId: string }): Promise<{ status: 'accepted' }>;
  /** Notifies after committed changes; events are hints to re-read local state. */
  onChanged(listener: (event: RecommendationChanged) => void): () => void;
}
