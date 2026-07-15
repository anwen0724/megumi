import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatDate,
  formatNumber,
  formatRelativeTime,
  formatTokenCount,
  initializeRendererI18n,
} from '@megumi/desktop/renderer/shared/i18n';

describe('desktop locale formatting', () => {
  beforeEach(async () => {
    await initializeRendererI18n('en-US');
  });

  it('uses the requested locale rather than the operating-system default', () => {
    expect(formatNumber(12_345.6, 'en-US')).toBe('12,345.6');
    expect(formatNumber(12_345.6, 'zh-CN')).toBe('12,345.6');
    expect(formatRelativeTime(-1, 'day', 'en-US')).toBe('yesterday');
    expect(formatRelativeTime(-1, 'day', 'zh-CN')).toBe('昨天');
  });

  it('formats token counts and rejects invalid timestamps without throwing', () => {
    expect(formatTokenCount(2_400, 'en-US')).toBe('2.4K');
    expect(formatTokenCount(2_400, 'zh-CN')).toBe('2.4千');
    expect(formatDate('not-a-date', 'en-US')).toBeNull();
  });
});
