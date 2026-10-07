/*
 * Verifies the source capability declaration: the planner and the program rely
 * on it, so its values are part of the contract, and an enabled source without a
 * connector is reported instead of disappearing.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sourceConfigurationIssues } from '@megumi/application/recommendation/recommendation-api';
import { createZhihuSource } from '@megumi/application/recommendation/sources/zhihu-source';

describe('source capability declaration', () => {
  it('declares the Zhihu capabilities the Spec fixes', () => {
    const source = createZhihuSource({ accessSecret: () => 'secret' });

    expect(source.id).toBe('zhihu');
    expect(source.descriptor).toEqual({
      id: 'zhihu',
      description: '中文问答与专栏文章。',
      maxResultsPerSearch: 10,
      supportsTimeRange: true,
      material: 'excerpt',
      supportsFetch: false,
    });
  });

  it('reports an enabled source that has no connector', () => {
    expect(sourceConfigurationIssues(['zhihu'])).toEqual([]);
    expect(sourceConfigurationIssues(['zhihu', 'bilibili'])).toEqual([
      {
        stage: 'configuration',
        code: 'SOURCE_NOT_CONFIGURED',
        subjectId: 'bilibili',
        message: 'Source bilibili is enabled but has no connector and is not planned.',
      },
    ]);
  });
});
