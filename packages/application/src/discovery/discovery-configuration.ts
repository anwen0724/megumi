/*
 * Owns validation and projection of source-aware Discovery configuration.
 */
import { z } from 'zod';
import type { DiscoverySourceId } from './sources/discovery-source';
import type { SourceRegistry } from './sources/source-registry';
import type { Settings } from '../settings/settings-store';

const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export interface DiscoveryConfigurationSettings {
  readonly candidateSupplyConfirmed: boolean;
  readonly recommendationCandidateCheckIntervalSeconds: number;
  readonly conversationRecognitionEnabled: boolean;
  readonly recommendationGenerationTime: string;
  readonly recommendationTargetCount: number;
  readonly recommendationWorkingSetCount: number;
  readonly enabledSources: readonly DiscoverySourceId[];
  readonly candidatePoolMinimumCount: number;
  readonly candidatePoolMaximumCount: number;
  readonly candidateValidityDays: number;
  readonly candidateContentExcerptMaxCharacters: number;
  readonly candidateSupplyCheckIntervalMinutes: number;
}

export type DiscoveryConfigurationStore = Pick<Settings, 'readSettings' | 'updateSettings'>;

export const UpdateDiscoveryConfigurationRequestSchema = z.object({
  recommendationCandidateCheckIntervalSeconds: z.number().int().positive().optional(),
  conversationRecognitionEnabled: z.boolean().optional(),
  recommendationGenerationTime: LocalTimeSchema.optional(),
  recommendationTargetCount: z.number().int().min(1).max(100).optional(),
  recommendationWorkingSetCount: z.number().int().min(1).max(200).optional(),
  enabledSources: z.array(z.string().trim().min(1)).optional(),
  candidatePoolMinimumCount: z.number().int().positive().optional(),
  candidatePoolMaximumCount: z.number().int().positive().optional(),
  candidateValidityDays: z.number().int().positive().optional(),
  candidateContentExcerptMaxCharacters: z.number().int().positive().optional(),
  candidateSupplyCheckIntervalMinutes: z.number().int().positive().optional(),
}).strict();
export const ConnectDiscoverySourceRequestSchema = z.object({
  sourceId: z.string().trim().min(1),
}).strict();
export const RefreshDiscoverySourceRequestSchema = ConnectDiscoverySourceRequestSchema;

export const DiscoverySourceViewSchema = z.object({
  sourceId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  access: z.enum(['public_http', 'configured_provider', 'browser_session']),
  supportedModes: z.array(z.enum(['relevance', 'recent'])).min(1),
  supportsRead: z.boolean(),
  enabled: z.boolean(),
  connectionState: z.enum(['ready', 'unknown', 'not_configured', 'login_required', 'rate_limited', 'risk_controlled']),
  provider: z.string().trim().min(1).optional(),
  checkedAt: z.string().datetime({ offset: true }).optional(),
  retryAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const DiscoveryConfigurationViewSchema = z.object({
  recommendationCandidateCheckIntervalSeconds: z.number().int().positive(),
  conversationRecognitionEnabled: z.boolean(),
  recommendationGenerationTime: LocalTimeSchema,
  recommendationTargetCount: z.number().int().min(1).max(100),
  recommendationWorkingSetCount: z.number().int().min(1).max(200),
  candidatePoolMinimumCount: z.number().int().positive(),
  candidatePoolMaximumCount: z.number().int().positive(),
  candidateValidityDays: z.number().int().positive(),
  candidateContentExcerptMaxCharacters: z.number().int().positive(),
  candidateSupplyCheckIntervalMinutes: z.number().int().positive(),
  sources: z.array(DiscoverySourceViewSchema),
}).strict();

export type UpdateDiscoveryConfigurationRequest = z.infer<typeof UpdateDiscoveryConfigurationRequestSchema>;
export type ConnectDiscoverySourceRequest = z.infer<typeof ConnectDiscoverySourceRequestSchema>;
export type RefreshDiscoverySourceRequest = z.infer<typeof RefreshDiscoverySourceRequestSchema>;

export type DiscoverySourceView = z.infer<typeof DiscoverySourceViewSchema>;
export type DiscoveryConfigurationView = z.infer<typeof DiscoveryConfigurationViewSchema>;

export interface DiscoveryConfiguration {
  /** Reads the configuration and current Source availability projection. */
  get(): Promise<DiscoveryConfigurationView>;
  /** Applies one validated partial configuration update. */
  update(request: UpdateDiscoveryConfigurationRequest): Promise<DiscoveryConfigurationView>;
  /** Opens the connection flow for one browser-session Source. */
  connectSource(request: ConnectDiscoverySourceRequest): Promise<DiscoverySourceView>;
  /** Rechecks one Source without opening an interactive connection flow. */
  refreshSource(request: RefreshDiscoverySourceRequest): Promise<DiscoverySourceView>;
  /** Rechecks selected Sources and returns the complete current projection. */
  refreshSources(sourceIds?: readonly DiscoverySourceId[]): Promise<DiscoveryConfigurationView>;
}

/** Creates user-facing Discovery configuration operations over Settings and Sources. */
export function createDiscoveryConfiguration(input: {
  readonly sourceRegistry: SourceRegistry;
  readonly settings: DiscoveryConfigurationStore;
}): DiscoveryConfiguration {
  const read = () => {
    const result = input.settings.readSettings();
    if (result.status === 'rejected') throw new Error(result.error.message);
    return result.settings;
  };
  const view = (): DiscoveryConfigurationView => {
    const settings = read().config.discovery;
    const enabled = new Set(settings.enabledSources);
    return {
      recommendationCandidateCheckIntervalSeconds: settings.recommendationCandidateCheckIntervalSeconds,
      conversationRecognitionEnabled: settings.conversationRecognitionEnabled,
      recommendationGenerationTime: settings.recommendationGenerationTime,
      recommendationTargetCount: settings.recommendationTargetCount,
      recommendationWorkingSetCount: settings.recommendationWorkingSetCount,
      candidatePoolMinimumCount: settings.candidatePoolMinimumCount,
      candidatePoolMaximumCount: settings.candidatePoolMaximumCount,
      candidateValidityDays: settings.candidateValidityDays,
      candidateContentExcerptMaxCharacters: settings.candidateContentExcerptMaxCharacters,
      candidateSupplyCheckIntervalMinutes: settings.candidateSupplyCheckIntervalMinutes,
      sources: input.sourceRegistry.listSources().map(({ descriptor, availability }) => sourceView({
        descriptor, availability, enabled: enabled.has(descriptor.id),
      })),
    };
  };

  return {
    get: async () => view(),
    update: async (request) => {
      const patch = UpdateDiscoveryConfigurationRequestSchema.parse(request);
      const result = input.settings.updateSettings({
        patch: { discovery: patch },
        expectedRevision: read().revision,
      });
      if (result.status === 'rejected') throw new Error(result.error.message);
      return view();
    },
    async connectSource(request) {
      const parsed = ConnectDiscoverySourceRequestSchema.parse(request);
      const source = input.sourceRegistry.get(parsed.sourceId);
      if (!source || source.descriptor.access !== 'browser_session' || !source.connect) {
        throw new Error('Discovery source does not provide a login operation.');
      }
      await source.connect();
      return sourceView({
        descriptor: source.descriptor,
        availability: source.getAvailability(),
        enabled: new Set(read().config.discovery.enabledSources).has(source.descriptor.id),
      });
    },
    async refreshSource(request) {
      const parsed = RefreshDiscoverySourceRequestSchema.parse(request);
      const source = input.sourceRegistry.get(parsed.sourceId);
      if (!source) throw new Error('Discovery source was not found.');
      await input.sourceRegistry.checkSources([source.descriptor.id]);
      return sourceView({
        descriptor: source.descriptor,
        availability: source.getAvailability(),
        enabled: new Set(read().config.discovery.enabledSources).has(source.descriptor.id),
      });
    },
    async refreshSources(sourceIds) {
      await input.sourceRegistry.checkSources(sourceIds ?? input.sourceRegistry.listDescriptors().map((source) => source.id));
      return view();
    },
  };
}

function sourceView(input: {
  readonly descriptor: ReturnType<SourceRegistry['listDescriptors']>[number];
  readonly availability: ReturnType<SourceRegistry['listSources']>[number]['availability'];
  readonly enabled: boolean;
}): DiscoverySourceView {
  return {
    sourceId: input.descriptor.id,
    name: input.descriptor.name,
    access: input.descriptor.access,
    supportedModes: [...input.descriptor.supportedModes],
    supportsRead: input.descriptor.supportsRead,
    enabled: input.enabled,
    connectionState: input.availability.state,
    ...(input.availability.provider ? { provider: input.availability.provider } : {}),
    ...(input.availability.checkedAt ? { checkedAt: input.availability.checkedAt } : {}),
    ...(input.availability.retryAt ? { retryAt: input.availability.retryAt } : {}),
  };
}
