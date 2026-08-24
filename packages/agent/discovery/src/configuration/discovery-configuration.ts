/* Owns validation and projection of source-aware Discovery configuration. */
import { z } from 'zod';
import type { DiscoverySourceId } from '../sources/discovery-source';
import type { SourceRegistry } from '../sources/source-registry';

const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export interface DiscoveryConfigurationSettings {
  readonly conversationRecognitionEnabled: boolean;
  readonly dailyGenerationTime: string;
  readonly dailyTargetCount: number;
  readonly enabledSources: readonly DiscoverySourceId[];
}

export interface DiscoveryConfigurationStore {
  read(): DiscoveryConfigurationSettings;
  write(settings: DiscoveryConfigurationSettings): Promise<void> | void;
}

export const UpdateDiscoveryConfigurationRequestSchema = z.object({
  conversationRecognitionEnabled: z.boolean().optional(),
  dailyGenerationTime: LocalTimeSchema.optional(),
  dailyTargetCount: z.number().int().min(1).max(100).optional(),
  enabledSources: z.array(z.string().trim().min(1)).min(1).optional(),
}).strict();
export const ConnectDiscoverySourceRequestSchema = z.object({
  sourceId: z.string().trim().min(1),
}).strict();

export const DiscoverySourceViewSchema = z.object({
  sourceId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  access: z.enum(['public_http', 'configured_provider', 'browser_session']),
  supportedModes: z.array(z.enum(['relevance', 'recent'])).min(1),
  supportsRead: z.boolean(),
  enabled: z.boolean(),
  connectionState: z.enum(['ready', 'unknown', 'not_configured', 'login_required', 'rate_limited', 'risk_controlled']),
  checkedAt: z.string().datetime({ offset: true }).optional(),
  retryAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const DiscoveryConfigurationViewSchema = z.object({
  conversationRecognitionEnabled: z.boolean(),
  dailyGenerationTime: LocalTimeSchema,
  dailyTargetCount: z.number().int().min(1).max(100),
  sources: z.array(DiscoverySourceViewSchema),
}).strict();

export type UpdateDiscoveryConfigurationRequest = z.infer<typeof UpdateDiscoveryConfigurationRequestSchema>;
export type ConnectDiscoverySourceRequest = z.infer<typeof ConnectDiscoverySourceRequestSchema>;

export type DiscoverySourceView = z.infer<typeof DiscoverySourceViewSchema>;
export type DiscoveryConfigurationView = z.infer<typeof DiscoveryConfigurationViewSchema>;

export interface DiscoveryConfiguration {
  get(): Promise<DiscoveryConfigurationView>;
  update(request: UpdateDiscoveryConfigurationRequest): Promise<DiscoveryConfigurationView>;
  connectSource(request: ConnectDiscoverySourceRequest): Promise<DiscoverySourceView>;
}

export function createDiscoveryConfiguration(input: {
  readonly sourceRegistry: SourceRegistry;
  readonly settings: DiscoveryConfigurationStore;
}): DiscoveryConfiguration {
  const view = (): DiscoveryConfigurationView => {
    const settings = input.settings.read();
    const enabled = new Set(settings.enabledSources);
    return {
      conversationRecognitionEnabled: settings.conversationRecognitionEnabled,
      dailyGenerationTime: settings.dailyGenerationTime,
      dailyTargetCount: settings.dailyTargetCount,
      sources: input.sourceRegistry.listSources().map(({ descriptor, availability }) => sourceView({
        descriptor, availability, enabled: enabled.has(descriptor.id),
      })),
    };
  };

  return {
    get: async () => view(),
    update: async (request) => {
      const patch = UpdateDiscoveryConfigurationRequestSchema.parse(request);
      const current = input.settings.read();
      const enabledSources = patch.enabledSources
        ? [...new Set(patch.enabledSources.map((sourceId) => sourceId.trim()))]
        : [...current.enabledSources];
      const registered = new Set(input.sourceRegistry.listDescriptors().map((source) => source.id));
      if (enabledSources.some((sourceId) => !registered.has(sourceId))) {
        throw new Error('Discovery configuration contains an unregistered source.');
      }
      await input.settings.write({
        conversationRecognitionEnabled: patch.conversationRecognitionEnabled ?? current.conversationRecognitionEnabled,
        dailyGenerationTime: patch.dailyGenerationTime ?? current.dailyGenerationTime,
        dailyTargetCount: patch.dailyTargetCount ?? current.dailyTargetCount,
        enabledSources,
      });
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
        enabled: new Set(input.settings.read().enabledSources).has(source.descriptor.id),
      });
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
    ...(input.availability.checkedAt ? { checkedAt: input.availability.checkedAt } : {}),
    ...(input.availability.retryAt ? { retryAt: input.availability.retryAt } : {}),
  };
}
