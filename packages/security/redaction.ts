export interface RedactionOptions {
  visiblePrefix?: number;
  visibleSuffix?: number;
}

const REDACTED = '[redacted]';
const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|token|secret|password|credential|cookie|private[-_]?key|raw.*(body|header|prompt|output))/i;
const DROP_KEY_PATTERN = /^(stack|cause)$/i;

const RUNTIME_SECRET_PATTERNS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g,
    replacement: `Bearer ${REDACTED}`,
  },
  {
    pattern: /\bsk-[A-Za-z0-9._-]{8,}\b/g,
    replacement: REDACTED,
  },
  {
    pattern: /\b(apiKey|api_key|token|secret|password)=([^&\s]+)/gi,
    replacement: `$1=${REDACTED}`,
  },
  {
    pattern: /\b(token|secret|password):\s*([^,\s]+)/gi,
    replacement: `$1: ${REDACTED}`,
  },
];

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

export function redactRuntimeMessage(message: string): string {
  return RUNTIME_SECRET_PATTERNS.reduce(
    (current, rule) => current.replace(rule.pattern, rule.replacement),
    message,
  );
}

export function redactRuntimeValue<T>(value: T): T {
  if (typeof value === 'string') {
    return redactRuntimeMessage(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactRuntimeValue(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, entryValue]) => {
    if (DROP_KEY_PATTERN.test(key)) {
      return [];
    }

    if (SECRET_KEY_PATTERN.test(key)) {
      return [[key, REDACTED] as const];
    }

    return [[key, redactRuntimeValue(entryValue)] as const];
  });

  return Object.fromEntries(entries) as T;
}

export function redactRuntimeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  return redactRuntimeValue(details);
}

export function redactObjectSecrets<T>(value: T): T {
  return redactRuntimeValue(value);
}
