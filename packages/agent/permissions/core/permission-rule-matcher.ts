/* Matches structured rules against normalized operations and stable tool identities. */
import type { PermissionOperation, PermissionRule } from '../contracts/permission-contracts';

export function matchesPermissionRule(rule: PermissionRule, operation: PermissionOperation): boolean {
  if (rule.target.kind === 'tool') return sameIdentity(rule.target.tool_identity, operation.context.tool_identity);
  if (rule.target.action !== operation.action) return false;
  if (!rule.target.resource) return true;
  if (!operation.resource || rule.target.resource.type !== operation.resource.type) return false;
  const matcher = rule.target.resource.matcher;
  if (matcher.operator === 'any') return true;
  const id = operation.resource.id;
  if (!id) return false;
  if (matcher.operator === 'exact') return normalizeForResource(id, operation.resource.type) === normalizeForResource(matcher.value, operation.resource.type);
  if (matcher.operator === 'prefix') return prefixMatches(id, matcher.value, operation.resource.type);
  if (matcher.operator === 'glob') return globToRegExp(normalizeForResource(matcher.value, operation.resource.type)).test(normalizeForResource(id, operation.resource.type));
  const hostname = typeof operation.resource.attributes?.hostname === 'string'
    ? operation.resource.attributes.hostname : safeHostname(id);
  const pattern = matcher.value.toLowerCase().replace(/\.$/, '');
  if (pattern === '*') return Boolean(hostname);
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname !== suffix && hostname?.endsWith(`.${suffix}`) === true;
  }
  return hostname === pattern;
}

function sameIdentity(left: { source_id: string; namespace: string; source_tool_name: string }, right: { source_id: string; namespace: string; source_tool_name: string }): boolean {
  return left.source_id === right.source_id && left.namespace === right.namespace && left.source_tool_name === right.source_tool_name;
}
function normalize(value: string): string { return value.replace(/\\/g, '/').trim(); }
function normalizeForResource(value: string, resourceType: string): string {
  const normalized = normalize(value);
  return resourceType === 'workspace.path' && (/^[a-z]:\//i.test(normalized) || normalized.startsWith('//'))
    ? normalized.toLowerCase()
    : normalized;
}
function prefixMatches(id: string, value: string, resourceType: string): boolean {
  const candidate = normalizeForResource(id, resourceType);
  const prefix = normalizeForResource(value, resourceType).replace(/\/$/, '');
  if (candidate === prefix) return true;
  if (resourceType === 'workspace.path') return candidate.startsWith(`${prefix}/`);
  if (resourceType === 'process.command') return candidate.startsWith(prefix) && /^\s/.test(candidate.slice(prefix.length, prefix.length + 1));
  return candidate.startsWith(prefix);
}
function globToRegExp(pattern: string): RegExp {
  const source = pattern.split('').map((char, index) => {
    if (char === '*' && pattern[index + 1] === '*') return index > 0 && pattern[index - 1] === '*' ? '' : '.*';
    if (char === '*') return '[^/]*';
    return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }).join('');
  return new RegExp(`^${source}$`);
}
function safeHostname(value: string): string | undefined { try { return new URL(value).hostname.toLowerCase(); } catch { return undefined; } }
