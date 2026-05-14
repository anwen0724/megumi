import type { RedactionOptions } from './types';

const REDACTED = '[redacted]';
const SECRET_KEY_PATTERN = /(api[-_]?key|token|secret|password|credential)/i;

export function redactSecret(value: string, options: RedactionOptions = {}): string {
  const visiblePrefix = Math.max(0, options.visiblePrefix ?? 0);
  const visibleSuffix = Math.max(0, options.visibleSuffix ?? 0);

  if (visiblePrefix === 0 && visibleSuffix === 0) {
    return REDACTED;
  }

  if (value.length <= visiblePrefix + visibleSuffix) {
    return REDACTED;
  }

  const prefix = visiblePrefix > 0 ? value.slice(0, visiblePrefix) : '';
  const suffix = visibleSuffix > 0 ? value.slice(value.length - visibleSuffix) : '';

  return `${prefix}...${REDACTED}...${suffix}`;
}

export function redactObjectSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactObjectSecrets(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
    if (SECRET_KEY_PATTERN.test(key)) {
      return [key, REDACTED];
    }

    return [key, redactObjectSecrets(entryValue)];
  });

  return Object.fromEntries(entries) as T;
}
