/* Verifies strict Discovery Host DTOs and business-owner forwarding. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DiscoveryDailyEnsurePayloadSchema,
  DiscoveryConfigurationGetPayloadSchema,
  DiscoveryConfigurationUpdatePayloadSchema,
  DiscoveryHomePayloadSchema,
  DiscoveryInterestChangePayloadSchema,
  DiscoveryRecommendationSearchPayloadSchema,
  DiscoveryRecommendationStatePayloadSchema,
  DiscoverySessionParticipationPayloadSchema,
} from '@megumi/product-host/host';
import { createDiscoveryOperations } from '../../../../packages/agent/product-host/src/operations/discovery-operations';

describe('Discovery Host', () => {
  it('uses strict request schemas at every renderer-facing operation', () => {
    expect(() => DiscoveryInterestChangePayloadSchema.parse({ action: 'create', description: 'Agent', extra: true })).toThrow();
    expect(() => DiscoveryConfigurationGetPayloadSchema.parse({ extra: true })).toThrow();
    expect(() => DiscoveryConfigurationUpdatePayloadSchema.parse({ enabledSources: [], extra: true })).toThrow();
    expect(() => DiscoverySessionParticipationPayloadSchema.parse({ sessionId: 's', participation: 'included', extra: true })).toThrow();
    expect(() => DiscoveryDailyEnsurePayloadSchema.parse({ trigger: 'manual', now: '2026-08-22T10:00:00.000Z', extra: true })).toThrow();
    expect(() => DiscoveryHomePayloadSchema.parse({ mode: 'timeline', extra: true })).toThrow();
    expect(() => DiscoveryRecommendationSearchPayloadSchema.parse({ query: 'Agent', extra: true })).toThrow();
    expect(() => DiscoveryRecommendationStatePayloadSchema.parse({ recommendationId: 'r', action: 'opened', extra: true })).toThrow();
  });

  it('forwards DTOs to Discovery without reading Repository or Sources', async () => {
    const agent = {
      getDiscoveryConfiguration: vi.fn(async () => ({ sources: [] })),
      updateDiscoveryConfiguration: vi.fn(async () => ({ sources: [] })),
      changeInterest: vi.fn(async (request) => ({ ...request, interestId: 'interest:1', status: 'active' })),
      setSessionParticipation: vi.fn(async (request) => ({ ...request, effectiveFrom: '2026-08-22T10:00:00.000Z', updatedAt: '2026-08-22T10:00:00.000Z' })),
      ensureDailyRecommendation: vi.fn(async () => ({
        status: 'waiting_for_candidates', localDate: '2026-08-22', requestedCount: 20,
      })),
      getDiscoveryHome: vi.fn(async () => ({ mode: 'timeline' })),
      searchRecommendations: vi.fn(async () => ({ query: 'Agent', recommendations: [] })),
      updateRecommendationState: vi.fn(async () => ({ recommendationId: 'recommendation:1' })),
    };
    const host = createDiscoveryOperations(agent as never);

    await host.getConfiguration();
    await host.updateConfiguration({ enabledSources: ['open_web'] });
    await host.changeInterest({ action: 'create', description: 'Agent' });
    await host.setSessionParticipation({ sessionId: 'session:1', participation: 'excluded' });
    await host.ensureDaily({ trigger: 'manual', now: '2026-08-22T10:00:00.000Z' });
    await host.getHome({ mode: 'timeline' });
    await host.searchRecommendations({ query: 'Agent' });
    await host.updateRecommendationState({ recommendationId: 'recommendation:1', action: 'opened' });

    expect(agent.changeInterest).toHaveBeenCalledWith({ action: 'create', description: 'Agent' });
    expect(agent.getDiscoveryConfiguration).toHaveBeenCalledOnce();
    expect(agent.updateDiscoveryConfiguration).toHaveBeenCalledWith({ enabledSources: ['open_web'] });
    expect(agent.setSessionParticipation).toHaveBeenCalledWith({ sessionId: 'session:1', participation: 'excluded' });
    expect(agent.ensureDailyRecommendation).toHaveBeenCalledOnce();
    expect(agent.getDiscoveryHome).toHaveBeenCalledOnce();
    expect(agent.searchRecommendations).toHaveBeenCalledOnce();
    expect(agent.updateRecommendationState).toHaveBeenCalledOnce();
  });
});
