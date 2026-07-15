/* Provides locale-explicit formatting without changing canonical values. */
import type { AppLanguage } from '@megumi/product/host-interface';
import { getRendererLanguage } from './locale';

function localeOrCurrent(locale?: AppLanguage): AppLanguage {
  return locale ?? getRendererLanguage();
}

export function formatNumber(value: number, locale?: AppLanguage): string {
  return new Intl.NumberFormat(localeOrCurrent(locale)).format(value);
}

export function formatTokenCount(value: number, locale?: AppLanguage): string {
  const resolved = localeOrCurrent(locale);
  if (Math.abs(value) < 1_000) return formatNumber(value, resolved);
  const compact = new Intl.NumberFormat(resolved, { maximumFractionDigits: 1 }).format(value / 1_000);
  return `${compact}${resolved === 'zh-CN' ? '千' : 'K'}`;
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale?: AppLanguage,
): string {
  return new Intl.RelativeTimeFormat(localeOrCurrent(locale), { numeric: 'auto' }).format(value, unit);
}

export function formatDate(
  value: string | Date,
  locale?: AppLanguage,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(localeOrCurrent(locale), options).format(date);
}

export function formatTime(
  value: string | Date,
  locale?: AppLanguage,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string | null {
  return formatDate(value, locale, options);
}
