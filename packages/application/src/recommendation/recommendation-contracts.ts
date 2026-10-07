/*
 * Defines the renderer-safe Candidate Supply request schemas and the Product
 * Host contract consumed by Desktop. The area keeps its historical `discovery`
 * name in the IPC namespace and the Application operations key; every type
 * below describes the current behaviour, not the removed recommendation flow.
 */
import { z } from 'zod';
import { InterestTextSchema, InterestSnapshotEntrySchema } from './interests/interest-contracts';
import { SourceAccessViewSchema, SourceIdSchema, type SourceAccessView, type SourceLoginResult } from './sources/source-access-contracts';
export { SourceAccessViewSchema, SourceLoginResultSchema, type SourceAccessView, type SourceLoginResult } from './sources/source-access-contracts';
export const SourceAccessRequestSchema = z.object({ sourceId: SourceIdSchema }).strict();
export type SourceAccessRequest = z.infer<typeof SourceAccessRequestSchema>;

/** One interest as the product shows it: the saved description and enable state. */
export const InterestUiSchema = InterestSnapshotEntrySchema;
export type InterestUi = z.infer<typeof InterestUiSchema>;

/** Empty payload used by the read-only Host requests. */
export const DiscoveryEmptyPayloadSchema = z.object({}).strict();
export type DiscoveryEmptyPayload = z.infer<typeof DiscoveryEmptyPayloadSchema>;

export const DiscoveryInterestListResultSchema = z
  .object({ interests: z.array(InterestUiSchema) })
  .strict();
export type DiscoveryInterestListResult = z.infer<typeof DiscoveryInterestListResultSchema>;

/**
 * One user edit. `pause` and `resume` are enable-state updates of the same
 * interest, so the desktop keeps one operation instead of two code paths.
 */
export const DiscoveryInterestChangePayloadSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('create'), description: InterestTextSchema })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      interestId: z.string().min(1),
      expectedRevision: z.number().int().positive(),
      description: InterestTextSchema,
    })
    .strict(),
  z.object({ action: z.literal('pause'), interestId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('resume'), interestId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('delete'), interestId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict(),
]);
export type DiscoveryInterestChangePayload = z.infer<typeof DiscoveryInterestChangePayloadSchema>;

/**
 * The saved interests after one edit. Returning the list keeps the desktop from
 * re-reading and racing its own change; a rejected edit stays visible as one.
 */
export const DiscoveryInterestChangeResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('changed'), interests: z.array(InterestUiSchema) }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('revision_conflict') }).strict(),
  z.object({ status: z.literal('invalid_request'), message: z.string().min(1) }).strict(),
]);
export type DiscoveryInterestChangeResult = z.infer<typeof DiscoveryInterestChangeResultSchema>;

/**
 * One source as the settings UI shows it. There is no availability probe: the
 * first-version source is the Zhihu API, so the only facts are whether the user
 * keeps it enabled and whether a credential is available.
 */
export const SupplySourceViewSchema = SourceAccessViewSchema
  .extend({
    name: z.string().trim().min(1),
    enabled: z.boolean(),
    credentialConfigured: z.boolean(),
  })
  .strict();
export type SupplySourceView = z.infer<typeof SupplySourceViewSchema>;

export const SupplyConfigurationViewSchema = z
  .object({
    /** False until the user accepts the first supply run; supply starts no external work before that. */
    candidateSupplyConfirmed: z.boolean(),
    sources: z.array(SupplySourceViewSchema),
  })
  .strict();
export type SupplyConfigurationView = z.infer<typeof SupplyConfigurationViewSchema>;

export const SupplyConfigurationUpdatePayloadSchema = z
  .object({ enabledSources: z.array(z.enum(['tavily','bing_rss','zhihu','bilibili','xiaohongshu'])).optional() })
  .strict();
export type SupplyConfigurationUpdatePayload = z.infer<
  typeof SupplyConfigurationUpdatePayloadSchema
>;

export const SupplyConfirmResultSchema = z
  .object({ status: z.enum(['confirmed', 'already_confirmed']) })
  .strict();
export type SupplyConfirmResult = z.infer<typeof SupplyConfirmResultSchema>;

/**
 * The product surface of user interests and candidate supply. Candidate
 * preparation and maintenance stay inside the main process: this contract adds
 * no candidate-pool IPC, HTTP API, or UI event bus.
 */
export interface DiscoveryHost {
  /** Opens an isolated platform window; opening does not confirm login. */
  openSourceLogin(request: SourceAccessRequest): Promise<SourceLoginResult>;
  /** Makes one bounded read-only access check; configuration reads never probe. */
  checkSourceAccess(request: SourceAccessRequest): Promise<SourceAccessView>;
  /** Reads the saved interests without model or source work. */
  listInterests(request?: DiscoveryEmptyPayload): Promise<DiscoveryInterestListResult>;
  /** Creates, edits, enables, disables, or deletes one interest. */
  changeInterest(request: DiscoveryInterestChangePayload): Promise<DiscoveryInterestChangeResult>;
  /** Reads the supply enable state and the configured sources. */
  getConfiguration(request?: DiscoveryEmptyPayload): Promise<SupplyConfigurationView>;
  /** Applies one validated partial configuration update. */
  updateConfiguration(
    request: SupplyConfigurationUpdatePayload,
  ): Promise<SupplyConfigurationView>;
  /** Records the user's acceptance of the first supply run. */
  confirmCandidateSupply(request?: DiscoveryEmptyPayload): Promise<SupplyConfirmResult>;
}
