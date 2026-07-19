/*
 * Defines the public action, resource, context, rule, and decision contracts
 * owned by Agent Action Permissions.
 */
import { z } from 'zod';

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));

export const PermissionModeSchema = z.enum(['ask', 'auto', 'full_access']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;
export const SafetyAssessmentSchema = z.enum(['safe', 'potentially_unsafe', 'prohibited']);
export type SafetyAssessment = z.infer<typeof SafetyAssessmentSchema>;

export const PermissionActionIdSchema = z.enum([
  'workspace.read', 'workspace.write', 'process.execute', 'network.search',
  'network.fetch', 'agent.context.activate', 'external.invoke',
]);
export type PermissionActionId = z.infer<typeof PermissionActionIdSchema>;
export const PermissionResourceTypeSchema = z.enum([
  'workspace.path', 'process.command', 'network.public_web', 'network.url', 'tool.identity',
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
  source_id: z.string().min(1), namespace: z.string().min(1), source_tool_name: z.string().min(1),
}).strict();
export type StableToolIdentity = z.infer<typeof StableToolIdentitySchema>;

export const RegisteredToolFactsSchema = StableToolIdentitySchema.extend({
  registered_tool_name: z.string().min(1),
}).strict();
export type RegisteredToolFacts = z.infer<typeof RegisteredToolFactsSchema>;

export const PermissionOperationSchema = z.object({
  action: PermissionActionIdSchema,
  resource: z.object({
    type: PermissionResourceTypeSchema, id: z.string().min(1).optional(),
    attributes: z.record(z.string(), JsonValueSchema).optional(),
  }).strict().optional(),
  context: z.object({
    workspace_id: z.string().min(1), session_id: z.string().min(1), run_id: z.string().min(1),
    tool_identity: RegisteredToolFactsSchema,
  }).strict(),
}).strict().superRefine((operation, context) => {
  validateActionResource(operation.action, operation.resource, context, ['resource']);
  const attributes = operation.resource?.attributes;
  if (!attributes) return;
  const allowed = operation.resource?.type === 'network.url' ? new Set(['hostname']) : new Set<string>();
  for (const key of Object.keys(attributes)) {
    if (!allowed.has(key)) context.addIssue({ code: 'custom', path: ['resource', 'attributes', key], message: `Unsupported ${operation.resource?.type} attribute` });
  }
  if ('hostname' in attributes && typeof attributes.hostname !== 'string') {
    context.addIssue({ code: 'custom', path: ['resource', 'attributes', 'hostname'], message: 'hostname must be a string' });
  }
});
export type PermissionOperation = z.infer<typeof PermissionOperationSchema>;

export const PermissionResourceMatcherSchema = z.discriminatedUnion('operator', [
  z.object({ operator: z.literal('any') }).strict(),
  z.object({ operator: z.literal('exact'), value: z.string().min(1) }).strict(),
  z.object({ operator: z.literal('prefix'), value: z.string().min(1) }).strict(),
  z.object({ operator: z.literal('glob'), value: z.string().min(1) }).strict(),
  z.object({ operator: z.literal('hostname'), value: z.string().trim().min(1).refine(isHostnamePattern, 'Invalid hostname pattern') }).strict(),
]);

export const PermissionRuleSchema = z.object({
  source: z.enum(['user', 'workspace', 'session']), source_id: z.string().min(1).optional(),
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('operation'), action: PermissionActionIdSchema,
      resource: z.object({ type: PermissionResourceTypeSchema, matcher: PermissionResourceMatcherSchema }).strict().optional(),
    }).strict(),
    z.object({ kind: z.literal('tool'), tool_identity: StableToolIdentitySchema }).strict(),
  ]),
  reason: z.string().min(1).optional(),
}).strict().superRefine((rule, context) => {
  if ((rule.source === 'workspace' || rule.source === 'session') && !rule.source_id) {
    context.addIssue({ code: 'custom', path: ['source_id'], message: `${rule.source} permission rule requires source_id` });
  }
  if (rule.source === 'user' && rule.source_id) {
    context.addIssue({ code: 'custom', path: ['source_id'], message: 'user permission rules must not define source_id' });
  }
  if (rule.target.kind === 'operation') {
    validateActionResource(rule.target.action, rule.target.resource, context, ['target', 'resource']);
    const resource = rule.target.resource;
    if (resource && !matcherAllowed(resource.type, resource.matcher.operator)) {
      context.addIssue({ code: 'custom', path: ['target', 'resource', 'matcher', 'operator'], message: `${resource.type} does not support ${resource.matcher.operator} matcher` });
    }
  }
});
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const PermissionSettingsSchema = z.object({
  mode: PermissionModeSchema,
  allow: z.array(PermissionRuleSchema), ask: z.array(PermissionRuleSchema), deny: z.array(PermissionRuleSchema),
}).strict();
export type PermissionSettings = z.infer<typeof PermissionSettingsSchema>;

export const WorkspacePathPermissionFactsSchema = z.object({
  absolute_path: z.string().min(1), workspace_path: z.string().min(1), inside_workspace: z.boolean(),
  protected: z.boolean(), sensitive: z.boolean(),
}).strict();
export type WorkspacePathPermissionFacts = z.infer<typeof WorkspacePathPermissionFactsSchema>;

export const RuntimeErrorSchema = z.object({
  code: z.string().min(1), message: z.string().min(1), details: z.record(z.string(), JsonValueSchema).optional(),
}).strict();
export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;

export const PermissionDenialCodeSchema = z.enum(['rule_denied', 'policy_denied']);
export type PermissionDenialCode = z.infer<typeof PermissionDenialCodeSchema>;

export const ApprovalOptionSchema: z.ZodTypeAny = z.object({
  option_id: z.string().min(1), scope: z.enum(['once', 'session']),
  display: z.object({ label: z.string().min(1), description: z.string().min(1) }).strict(),
  effect: z.discriminatedUnion('type', [
    z.object({ type: z.literal('current_tool_call') }).strict(),
    z.object({ type: z.literal('session_tool_grant'), rule: PermissionRuleSchema }).strict(),
  ]),
}).strict();
export type ApprovalOption = {
  option_id: string;
  scope: 'once' | 'session';
  display: { label: string; description: string };
  effect: { type: 'current_tool_call' } | { type: 'session_tool_grant'; rule: PermissionRule };
};

const DecisionBaseSchema = z.object({
  operations: z.array(PermissionOperationSchema).min(1), safety_assessment: SafetyAssessmentSchema, reason: z.string().min(1),
});
export const PermissionDecisionSchema = z.discriminatedUnion('type', [
  DecisionBaseSchema.extend({ type: z.literal('allow') }).strict(),
  DecisionBaseSchema.extend({ type: z.literal('deny'), denial_code: PermissionDenialCodeSchema }).strict(),
  DecisionBaseSchema.extend({
    type: z.literal('requires_approval'), options: z.array(ApprovalOptionSchema).min(1).max(2), default_option_id: z.string().min(1),
  }).strict(),
]).superRefine((decision, context) => {
  if (decision.type === 'requires_approval') {
    if (!decision.options.some((option: ApprovalOption) => option.option_id === decision.default_option_id)) {
      context.addIssue({ code: 'custom', path: ['default_option_id'], message: 'default option must exist' });
    }
    const once = decision.options.filter((option: ApprovalOption) => option.scope === 'once');
    const session = decision.options.filter((option: ApprovalOption) => option.scope === 'session');
    if (once.length !== 1 || session.length > 1 || once[0]?.option_id !== decision.default_option_id) {
      context.addIssue({ code: 'custom', path: ['options'], message: 'approval options require one default once option and at most one session option' });
    }
  }
});
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const EvaluateToolCallRequestSchema = z.object({
  run_id: z.string().min(1), session_id: z.string().min(1), workspace_id: z.string().min(1), tool_call_id: z.string().min(1),
  tool_input: z.unknown(), registered_tool: RegisteredToolFactsSchema,
  permission_mode: PermissionModeSchema, permission_settings: PermissionSettingsSchema,
  workspace_path: WorkspacePathPermissionFactsSchema.optional(),
  evaluated_at: z.string().min(1),
}).strict();
export type EvaluateToolCallRequest = z.infer<typeof EvaluateToolCallRequestSchema>;

export const EvaluateToolCallResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    operations: z.array(PermissionOperationSchema).min(1),
    decision: PermissionDecisionSchema,
  }).strict(),
  z.object({ status: z.literal('failed'), failure: RuntimeErrorSchema }).strict(),
]);
export type EvaluateToolCallResult = z.infer<typeof EvaluateToolCallResultSchema>;

const EXPECTED_RESOURCE: Record<PermissionActionId, PermissionResourceType | undefined> = {
  'workspace.read': 'workspace.path',
  'workspace.write': 'workspace.path',
  'process.execute': 'process.command',
  'network.search': 'network.public_web',
  'network.fetch': 'network.url',
  'agent.context.activate': undefined,
  'external.invoke': 'tool.identity',
};

function validateActionResource(
  action: PermissionActionId,
  resource: { type: PermissionResourceType } | undefined,
  context: z.RefinementCtx,
  path: Array<string | number>,
): void {
  const expected = EXPECTED_RESOURCE[action];
  if (resource && resource.type !== expected) {
    context.addIssue({ code: 'custom', path, message: `${action} only supports ${expected ?? 'no resource'}` });
  }
}

function matcherAllowed(resource: PermissionResourceType, operator: z.infer<typeof PermissionResourceMatcherSchema>['operator']): boolean {
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
  return hostname.length > 0 && !hostname.includes('/') && !hostname.includes(':') && !hostname.includes('*')
    && /^[a-z0-9.-]+$/i.test(hostname);
}
