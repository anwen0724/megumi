/*
 * Owns Permission modes, persisted rules, rule access ports, and internal matching semantics.
 */
import { z } from 'zod';
import { JsonValueSchema, type JsonObject, type JsonValue } from './json';

export { JsonValueSchema };

export const PermissionModeSchema = z.enum(['ask', 'auto', 'full_access']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const SafetyAssessmentSchema = z.enum(['safe', 'potentially_unsafe', 'prohibited']);
export type SafetyAssessment = z.infer<typeof SafetyAssessmentSchema>;

export const PermissionActionIdSchema = z.enum([
  'workspace.read',
  'workspace.write',
  'process.execute',
  'network.search',
  'network.fetch',
  'agent.context.activate',
  'external.invoke',
]);
export type PermissionActionId = z.infer<typeof PermissionActionIdSchema>;

export const PermissionResourceTypeSchema = z.enum([
  'workspace.path',
  'process.command',
  'network.public_web',
  'network.url',
  'tool.identity',
]);
export type PermissionResourceType = z.infer<typeof PermissionResourceTypeSchema>;

export const PERMISSION_RULE_CATALOG = [
  { action: 'workspace.read', resource_type: 'workspace.path', operators: ['any', 'exact', 'prefix', 'glob'] },
  { action: 'workspace.write', resource_type: 'workspace.path', operators: ['any', 'exact', 'prefix', 'glob'] },
  { action: 'process.execute', resource_type: 'process.command', operators: ['any', 'exact', 'prefix', 'glob'] },
  { action: 'network.search', resource_type: 'network.public_web', operators: ['any'] },
  { action: 'network.fetch', resource_type: 'network.url', operators: ['any', 'exact', 'hostname'] },
  { action: 'agent.context.activate', operators: [] },
  { action: 'external.invoke', resource_type: 'tool.identity', operators: ['any', 'exact'] },
] as const;

export const StableToolIdentitySchema = z.object({
  source_id: z.string().min(1),
  namespace: z.string().min(1),
  source_tool_name: z.string().min(1),
}).strict();
export type StableToolIdentity = z.infer<typeof StableToolIdentitySchema>;

export const PermissionResourceMatcherSchema = z.discriminatedUnion('operator', [
  z.object({ operator: z.literal('any') }).strict(),
  z.object({ operator: z.literal('exact'), value: z.string().min(1) }).strict(),
  z.object({ operator: z.literal('prefix'), value: z.string().min(1) }).strict(),
  z.object({ operator: z.literal('glob'), value: z.string().min(1) }).strict(),
  z.object({
    operator: z.literal('hostname'),
    value: z.string().trim().min(1).refine(isHostnamePattern, 'Invalid hostname pattern'),
  }).strict(),
]);

export const PermissionRuleSchema = z.object({
  source: z.enum(['user', 'workspace', 'session']),
  source_id: z.string().min(1).optional(),
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('operation'),
      action: PermissionActionIdSchema,
      resource: z.object({
        type: PermissionResourceTypeSchema,
        matcher: PermissionResourceMatcherSchema,
      }).strict().optional(),
    }).strict(),
    z.object({
      kind: z.literal('tool'),
      tool_identity: StableToolIdentitySchema,
    }).strict(),
  ]),
  reason: z.string().min(1).optional(),
}).strict().superRefine((rule, context) => {
  if ((rule.source === 'workspace' || rule.source === 'session') && !rule.source_id) {
    context.addIssue({
      code: 'custom', path: ['source_id'], message: `${rule.source} permission rule requires source_id`,
    });
  }
  if (rule.source === 'user' && rule.source_id) {
    context.addIssue({
      code: 'custom', path: ['source_id'], message: 'user permission rules must not define source_id',
    });
  }
  if (rule.target.kind !== 'operation') return;
  validateActionResource(rule.target.action, rule.target.resource, context, ['target', 'resource']);
  const resource = rule.target.resource;
  if (resource && !matcherAllowed(resource.type, resource.matcher.operator)) {
    context.addIssue({
      code: 'custom',
      path: ['target', 'resource', 'matcher', 'operator'],
      message: `${resource.type} does not support ${resource.matcher.operator} matcher`,
    });
  }
});
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const PermissionSettingsSchema = z.object({
  mode: PermissionModeSchema,
  allow: z.array(PermissionRuleSchema),
  ask: z.array(PermissionRuleSchema),
  deny: z.array(PermissionRuleSchema),
}).strict();
export type PermissionSettings = z.infer<typeof PermissionSettingsSchema>;

export const PermissionFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), JsonValueSchema).optional(),
}).strict();
export type PermissionFailure = z.infer<typeof PermissionFailureSchema>;

export type ResolvePermissionRulesResult =
  | { readonly status: 'resolved'; readonly permissionSettings: PermissionSettings }
  | { readonly status: 'failed'; readonly failure: PermissionFailure };

export interface PermissionRuleReader {
  resolvePermissionRules(request: {
    readonly workspaceId: string;
    readonly sessionId: string;
  }): ResolvePermissionRulesResult | Promise<ResolvePermissionRulesResult>;
}

export type AddPermissionRulesResult =
  | { readonly status: 'saved' }
  | { readonly status: 'failed'; readonly failure: PermissionFailure };

export interface PermissionRuleWriter {
  addPermissionRules(request: {
    readonly sessionId: string;
    readonly rules: readonly PermissionRule[];
    readonly appliedAt: string;
  }): AddPermissionRulesResult | Promise<AddPermissionRulesResult>;
}

export interface PermissionOperationForRuleMatch {
  readonly action: PermissionActionId;
  readonly resource?: {
    readonly type: PermissionResourceType;
    readonly id?: string;
    readonly attributes?: JsonObject;
  };
  readonly context: {
    readonly toolIdentity: {
      readonly sourceId: string;
      readonly namespace: string;
      readonly sourceToolName: string;
    };
  };
}

// Internal implementation: deliberately omitted from the Package public entry.
export function matchesPermissionRule(
  rule: PermissionRule,
  operation: PermissionOperationForRuleMatch,
): boolean {
  if (rule.target.kind === 'tool') {
    if (rule.source === 'session') return false;
    return rule.target.tool_identity.source_id === operation.context.toolIdentity.sourceId
      && rule.target.tool_identity.namespace === operation.context.toolIdentity.namespace
      && rule.target.tool_identity.source_tool_name === operation.context.toolIdentity.sourceToolName;
  }
  if (rule.target.action !== operation.action) return false;
  if (!rule.target.resource) return true;
  if (!operation.resource || rule.target.resource.type !== operation.resource.type) return false;
  const matcher = rule.target.resource.matcher;
  if (matcher.operator === 'any') return true;
  const id = operation.resource.id;
  if (!id) return false;
  if (matcher.operator === 'exact') {
    return normalizeForResource(id, operation.resource.type)
      === normalizeForResource(matcher.value, operation.resource.type);
  }
  if (matcher.operator === 'prefix') return prefixMatches(id, matcher.value, operation.resource.type);
  if (matcher.operator === 'glob') {
    return globToRegExp(normalizeForResource(matcher.value, operation.resource.type))
      .test(normalizeForResource(id, operation.resource.type));
  }
  const hostname = typeof operation.resource.attributes?.hostname === 'string'
    ? operation.resource.attributes.hostname.toLowerCase().replace(/\.$/, '')
    : safeHostname(id);
  const pattern = matcher.value.toLowerCase().replace(/\.$/, '');
  if (pattern === '*') return Boolean(hostname);
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname !== suffix && hostname?.endsWith(`.${suffix}`) === true;
  }
  return hostname === pattern;
}

function validateActionResource(
  action: PermissionActionId,
  resource: { type: PermissionResourceType } | undefined,
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  const expected: Record<PermissionActionId, PermissionResourceType | undefined> = {
    'workspace.read': 'workspace.path',
    'workspace.write': 'workspace.path',
    'process.execute': 'process.command',
    'network.search': 'network.public_web',
    'network.fetch': 'network.url',
    'agent.context.activate': undefined,
    'external.invoke': 'tool.identity',
  };
  if (resource && resource.type !== expected[action]) {
    context.addIssue({ code: 'custom', path, message: `${action} only supports ${expected[action] ?? 'no resource'}` });
  }
}

function matcherAllowed(
  resource: PermissionResourceType,
  operator: z.infer<typeof PermissionResourceMatcherSchema>['operator'],
): boolean {
  const allowed: Record<PermissionResourceType, readonly string[]> = {
    'workspace.path': ['any', 'exact', 'prefix', 'glob'],
    'process.command': ['any', 'exact', 'prefix', 'glob'],
    'network.public_web': ['any'],
    'network.url': ['any', 'exact', 'hostname'],
    'tool.identity': ['any', 'exact'],
  };
  return allowed[resource].includes(operator);
}

function isHostnamePattern(value: string): boolean {
  if (value === '*') return true;
  const hostname = value.startsWith('*.') ? value.slice(2) : value;
  return hostname.length > 0
    && !hostname.includes('/')
    && !hostname.includes(':')
    && !hostname.includes('*')
    && /^[a-z0-9.-]+$/i.test(hostname);
}

function normalizeForResource(value: string, resourceType: PermissionResourceType): string {
  const normalized = value.replace(/\\/g, '/').trim();
  return resourceType === 'workspace.path'
    && (/^[a-z]:\//i.test(normalized) || normalized.startsWith('//'))
    ? normalized.toLowerCase()
    : normalized;
}

function prefixMatches(id: string, value: string, resourceType: PermissionResourceType): boolean {
  const candidate = normalizeForResource(id, resourceType);
  const prefix = normalizeForResource(value, resourceType).replace(/\/$/, '');
  if (candidate === prefix) return true;
  if (resourceType === 'workspace.path') return candidate.startsWith(`${prefix}/`);
  if (resourceType === 'process.command') {
    return candidate.startsWith(prefix) && /^\s/.test(candidate.slice(prefix.length, prefix.length + 1));
  }
  return candidate.startsWith(prefix);
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern.split('').map((character, index) => {
    if (character === '*' && pattern[index + 1] === '*') {
      return index > 0 && pattern[index - 1] === '*' ? '' : '.*';
    }
    if (character === '*') return '[^/]*';
    return character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }).join('');
  return new RegExp(`^${source}$`);
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return undefined;
  }
}
