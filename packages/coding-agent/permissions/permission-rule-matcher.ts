// Matches Coding Agent permission rule patterns against tool name and input arguments.
import type { JsonValue } from '@megumi/shared/primitives';

export interface PermissionRuleMatchInput {
  toolName: string;
  input: JsonValue;
}

export interface PermissionRuleMatchResult {
  matched: boolean;
  toolName?: string;
  argument?: string;
}

interface ParsedPermissionRulePattern {
  toolName: string;
  argumentPattern: string;
}

export function matchPermissionRule(
  pattern: string,
  input: PermissionRuleMatchInput,
): PermissionRuleMatchResult {
  const parsed = parsePermissionRulePattern(pattern);
  if (!parsed || parsed.toolName !== input.toolName) {
    return { matched: false };
  }

  const argument = normalizePrimaryArgument(input.input);

  return {
    matched: wildcardMatch(parsed.argumentPattern, argument),
    toolName: parsed.toolName,
    argument,
  };
}

function parsePermissionRulePattern(pattern: string): ParsedPermissionRulePattern | undefined {
  if (/^[a-z][a-z0-9_]{0,63}$/.test(pattern)) {
    return {
      toolName: pattern,
      argumentPattern: '*',
    };
  }

  const match = /^([a-z][a-z0-9_]{0,63})\((.*)\)$/.exec(pattern);
  if (!match) {
    return undefined;
  }

  return {
    toolName: match[1],
    argumentPattern: match[2],
  };
}

function normalizePrimaryArgument(input: JsonValue): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return String(input ?? '').replace(/\\/g, '/').trim();
  }

  const record = input as Record<string, unknown>;
  const value = record.command ?? record.path ?? record.pattern ?? record.cwd ?? '';
  return String(value).replace(/\\/g, '/').trim();
}

function wildcardMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern.replace(/\\/g, '/').trim()).test(value);
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

