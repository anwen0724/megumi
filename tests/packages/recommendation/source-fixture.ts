/*
 * Shared fixture for tests that need a source connector. It carries the real
 * Zhihu capability declaration so tests exercise the production descriptor shape
 * without touching the platform.
 */
import type { SourceDescriptor } from '@megumi/application/recommendation/sources/source-connector';

export const stubDescriptor: SourceDescriptor = {
  id: 'zhihu',
  description: '中文问答与专栏文章。',
  accessPaths: ['credential', 'browser_session'],
  maxResultsPerSearch: 10,
  supportsTimeRange: true,
  material: 'excerpt',
  supportsFetch: false,
};
