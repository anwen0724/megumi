/*
 * Verifies the source capability declaration: the planner and the program rely
 * on it, so its values are part of the contract, and an enabled source without a
 * connector is reported instead of disappearing.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RecommendationConfigurationSchema } from '@megumi/application/settings/definitions/recommendation';
import { createZhihuSource } from '@megumi/application/recommendation/sources/zhihu-source';

describe('source capability declaration', () => {
  it('declares the Zhihu capabilities the Spec fixes', () => {
    const source = createZhihuSource({ accessSecret: () => 'secret' });

    expect(source.id).toBe('zhihu');
    expect(source.descriptor).toEqual({
      id: 'zhihu',
      description: '中文问答与专栏文章。',
      accessPaths: ['credential', 'browser_session'],
      maxResultsPerSearch: 10,
      supportsTimeRange: true,
      material: 'excerpt',
      supportsFetch: true,
    });
  });

  it('rejects an unknown service before planning', () => {
    expect(RecommendationConfigurationSchema.safeParse({ enabledSources: ['zhihu'] }).success).toBe(
      true,
    );
    expect(
      RecommendationConfigurationSchema.safeParse({ enabledSources: ['unknown'] }).success,
    ).toBe(false);
  });
});
