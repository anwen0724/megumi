/*
 * Matches Permissions-owned rule patterns against tool names and stable primary inputs.
 * V1 supports exact values and trailing value wildcards only.
 */
import type { PermissionRule } from '../contracts/permission-contracts';

export interface PermissionRuleMatchInput {
  tool_name: string;
  tool_input: unknown;
}

export interface PermissionRuleMatchResult {
  matched: boolean;
  field?: string;
  value?: string;
}

type ParsedPermissionRulePattern = {
  tool_name: string;
  field: string;
  value_pattern: string;
};

export function matchesPermissionRule(
  rule: PermissionRule,
  input: PermissionRuleMatchInput,
): PermissionRuleMatchResult {
  const parsed = parsePermissionRulePattern(rule.pattern);
  if (!parsed || parsed.tool_name !== input.tool_name) {
    return { matched: false };
  }

  const value = readStableField(input.tool_input, parsed.field);
  if (typeof value !== 'string') {
    return { matched: false, field: parsed.field };
  }

  return {
    matched: matchesValue(parsed.value_pattern, value),
    field: parsed.field,
    value,
  };
}

export function parsePermissionRulePattern(pattern: string): ParsedPermissionRulePattern | undefined {
  const match = /^tool:([a-z][a-z0-9_]{0,63})\|([a-z][a-z0-9_]{0,63})=(.*)$/.exec(pattern);
  if (!match) {
    return undefined;
  }

  return {
    tool_name: match[1],
    field: match[2],
    value_pattern: normalizeValue(match[3]),
  };
}

function readStableField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>)[field];
  return typeof value === 'string' ? normalizeValue(value) : undefined;
}

function matchesValue(pattern: string, value: string): boolean {
  if (pattern.endsWith('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return value === pattern;
}

function normalizeValue(value: string): string {
  return value.replace(/\\/g, '/').trim();
}
