/*
 * Applies permission decisions and approval grants before controlled tool execution.
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { JsonObject, JsonValue } from '@megumi/ai';
import type { ToolExecutionAccess } from '../sandbox/sandbox-scope';
import {
  JsonValueSchema,
  PermissionFailureSchema,
  PermissionModeSchema,
  PermissionRuleSchema,
  SafetyAssessmentSchema,
  PermissionOperationSchema,
  PermissionToolIdentitySchema,
  resolvePermissionOperations,
  resolveWorkspacePathTargets,
  matchesPermissionRule,
  type PermissionSettings,
  type PermissionRule,
  type SafetyAssessment,
  type PermissionOperation,
  type PermissionToolIdentity,
  type EvaluateToolCallRequest,
} from './permission-rules';
import type { AgentTool, ApprovalDecision } from '../tools/tool-contracts';
import { createWorkspacePathPolicy } from '../sandbox/file-access';
import { AgentFailure, type RunExecution } from '../execution/run-agent';
import { observeOperation } from '../diagnostics';

/** Product rule storage resolves the real rule scope associated with this run. */
export interface AgentPermissionRules {
  resolve(runId: string): Promise<{
    readonly permissionSettings: PermissionSettings;
    readonly workspaceId?: string;
    readonly sessionId?: string;
  }>;
  saveGrant(request: {
    readonly runId: string;
    readonly rule: PermissionRule;
    readonly appliedAt: string;
  }): Promise<void>;
}

/** Evaluates actual operations and applies only an approval for the unchanged subject. */
export async function authorizeTool(request: {
  readonly run: RunExecution;
  readonly tool: AgentTool;
  readonly toolCallId: string;
  readonly input: JsonValue;
  readonly operations: ReturnType<AgentTool['operations']>;
  readonly signal: AbortSignal;
}): Promise<
  | { readonly status: 'allowed'; readonly access: ToolExecutionAccess }
  | { readonly status: 'denied' }
> {
  const { run, tool, signal } = request;
  const mode = run.request.config.permissionMode;
  if (!request.operations.length) {
    return {
      status: 'allowed',
      access: executionAccessFor({ permissionMode: mode, operations: [] }),
    };
  }
  const resolve = async () => {
    const scope = await run.permissionRules?.resolve(run.runId);
    signal.throwIfAborted();
    const evaluation: EvaluateToolCallRequest = {
      executionId: run.runId,
      toolCallId: request.toolCallId,
      toolInput: request.input,
      workspaceId: scope?.workspaceId,
      sessionId: scope?.sessionId,
      permissionMode: mode,
      evaluatedAt: new Date().toISOString(),
      operations: request.operations.map((operation) => ({
        ...operation,
        context: {
          executionId: run.runId,
          workspaceId: scope?.workspaceId,
          sessionId: scope?.sessionId,
          toolIdentity: {
            ...(tool.identity ?? {
              sourceId: 'built_in',
              namespace: 'megumi',
              sourceToolName: tool.name,
            }),
            registeredToolName: tool.name,
          },
        },
      })),
    };
    const workspacePaths: Record<
      string,
      import('./permission-rules').WorkspacePathPermissionFacts
    > = {};
    for (const target of resolveWorkspacePathTargets(evaluation)) {
      const environment = run.request.config.environment;
      if (!environment) throw new Error('File operations require an execution environment.');
      const classified = await createWorkspacePathPolicy().classifyCanonicalPath({
        workspace_root: environment.workingDirectory,
        target_path: target.path,
        file_system: fs,
      });
      workspacePaths[target.key] = {
        absolutePath: classified.absolute_path,
        workspacePath: classified.workspace_path,
        insideWorkspace: classified.inside_workspace,
        protected: classified.protected,
        sensitive: classified.sensitive,
      };
    }
    const resolved = resolvePermissionOperations({ evaluation, workspacePaths });
    return {
      evaluation,
      ...evaluatePermissionPolicy({
        evaluation,
        ...resolved,
        permissionSettings: scope?.permissionSettings ?? { mode, allow: [], ask: [], deny: [] },
      }),
    };
  };
  const original = await resolve();
  signal.throwIfAborted();
  if (original.decision.type === 'deny') return { status: 'denied' };
  if (original.decision.type === 'allow') {
    return {
      status: 'allowed',
      access: executionAccessFor({
        permissionMode: mode,
        operations: original.decision.operations,
      }),
    };
  }
  const awaitApproval = run.request.awaitApproval;
  if (!awaitApproval) return { status: 'denied' };
  const permissionDecision = original.decision;
  const approvalId = randomUUID();
  run.approvalWaiting(approvalId, true);
  let decision: ApprovalDecision;
  try {
    decision = await observeOperation(
      run.diagnostics,
      {
        runId: run.runId,
        name: 'permission.await',
        toolCallId: request.toolCallId,
        toolName: tool.name,
      },
      () =>
        waitForApproval(signal, () =>
          awaitApproval({
            ...structuredClone({
              approvalId,
              runId: run.runId,
              toolCallId: request.toolCallId,
              operations: permissionDecision.operations,
              decision: permissionDecision,
              subject: original.approvalSubject,
            }),
            signal,
          }),
        ),
      (result) => ({ status: result.status === 'cancelled' ? 'cancelled' : 'ok' }),
    );
  } catch (cause) {
    signal.throwIfAborted();
    throw new AgentFailure(
      'executing_tools',
      { code: 'TOOL_SYSTEM_FAILED', message: 'Approval interaction failed.', retryable: false },
      { cause },
    );
  } finally {
    run.approvalWaiting(approvalId, false);
  }
  signal.throwIfAborted();
  if (decision.status !== 'allowed') return { status: 'denied' };
  const current = await resolve();
  if (current.decision.type === 'deny') return { status: 'denied' };
  const applied = resolveApprovalEffect({
    originalPermissionDecision: permissionDecision,
    originalSubject: original.approvalSubject,
    currentSubject: current.approvalSubject,
    sessionId: current.evaluation.sessionId,
    permissionMode: mode,
    appliedAt: new Date().toISOString(),
    decision: {
      decision: 'approved',
      approvalRequestId: approvalId,
      optionId: decision.optionId ?? permissionDecision.defaultOptionId,
      decidedBy: 'user',
      decidedAt: new Date().toISOString(),
    },
  });
  if (applied.status !== 'applied') return { status: 'denied' };
  if (applied.effect.type === 'session_tool_grant' && run.permissionRules) {
    await run.permissionRules.saveGrant({
      runId: run.runId,
      rule: applied.effect.rule,
      appliedAt: new Date().toISOString(),
    });
  }
  signal.throwIfAborted();
  return {
    status: 'allowed',
    access: executionAccessFor({
      permissionMode: mode,
      operations: current.decision.operations,
      approved: true,
    }),
  };
}

/** Cancellation ends the approval wait; a later decision has no execution authority. */
function waitForApproval(
  signal: AbortSignal,
  request: () => Promise<ApprovalDecision>,
): Promise<ApprovalDecision> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return request();
      })
      .then(
        (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
  });
}
/* Resolves the minimum executable file, process, and network scope for an allowed ToolCall. */

export const ToolExecutionAccessSchema: z.ZodType<ToolExecutionAccess> = z
  .object({
    fileSystem: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('workspace') }).strict(),
      z
        .object({
          mode: z.literal('workspace_and_paths'),
          readablePaths: z.array(z.string().min(1)),
          writablePaths: z.array(z.string().min(1)),
        })
        .strict(),
      z.object({ mode: z.literal('unrestricted') }).strict(),
    ]),
    process: z.enum(['sandboxed', 'unrestricted']),
    network: z.enum(['denied', 'unrestricted']),
  })
  .strict();

export function executionAccessFor(request: {
  readonly permissionMode: EvaluateToolCallRequest['permissionMode'];
  readonly operations: readonly PermissionOperation[];
  readonly approved?: boolean;
}): ToolExecutionAccess {
  if (request.permissionMode === 'full_access') {
    return {
      fileSystem: { mode: 'unrestricted' },
      process: 'unrestricted',
      network: 'unrestricted',
    };
  }

  const executesProcess = request.operations.some(
    (operation) => operation.action === 'process.execute',
  );
  if (request.approved === true && executesProcess) {
    return {
      fileSystem: { mode: 'unrestricted' },
      process: 'unrestricted',
      network: 'unrestricted',
    };
  }

  const readablePaths: string[] = [];
  const writablePaths: string[] = [];
  for (const operation of request.operations) {
    if (
      (operation.action !== 'workspace.read' && operation.action !== 'workspace.write') ||
      operation.resource?.type !== 'workspace.path' ||
      operation.resource.attributes?.insideWorkspace !== false ||
      !operation.resource.id
    )
      continue;
    (operation.action === 'workspace.read' ? readablePaths : writablePaths).push(
      operation.resource.id,
    );
  }
  const hasExternalPaths = readablePaths.length > 0 || writablePaths.length > 0;
  const needsNetwork = request.operations.some(
    (operation) => operation.action === 'network.fetch' || operation.action === 'network.search',
  );
  return {
    fileSystem: hasExternalPaths
      ? {
          mode: 'workspace_and_paths',
          readablePaths: [...new Set(readablePaths)].sort(),
          writablePaths: [...new Set(writablePaths)].sort(),
        }
      : { mode: 'workspace' },
    process: 'sandboxed',
    network: needsNetwork ? 'unrestricted' : 'denied',
  };
}

/*
 * Defines immutable Approval subjects, user decisions, effects, and application validation.
 */

export const PermissionDenialCodeSchema = z.enum(['rule_denied', 'policy_denied']);
export type PermissionDenialCode = z.infer<typeof PermissionDenialCodeSchema>;

export const ApprovalScopeSchema = z.enum(['once', 'session']);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

export const ApprovalOptionSchema = z
  .object({
    optionId: z.string().min(1),
    scope: ApprovalScopeSchema,
    display: z
      .object({
        label: z.string().min(1),
        description: z.string().min(1),
      })
      .strict(),
    effect: z.discriminatedUnion('type', [
      z.object({ type: z.literal('current_tool_call') }).strict(),
      z
        .object({
          type: z.literal('session_tool_grant'),
          rule: PermissionRuleSchema,
        })
        .strict(),
    ]),
  })
  .strict();
export type ApprovalOption = z.infer<typeof ApprovalOptionSchema>;

const PermissionDecisionBaseSchema = z.object({
  operations: z.array(PermissionOperationSchema).min(1),
  safetyAssessment: SafetyAssessmentSchema,
  safetySummary: z.string().min(1),
  reason: z.string().min(1),
});

export const PermissionDecisionSchema = z
  .discriminatedUnion('type', [
    PermissionDecisionBaseSchema.extend({ type: z.literal('allow') }).strict(),
    PermissionDecisionBaseSchema.extend({
      type: z.literal('deny'),
      denialCode: PermissionDenialCodeSchema,
    }).strict(),
    PermissionDecisionBaseSchema.extend({
      type: z.literal('requires_approval'),
      options: z.array(ApprovalOptionSchema).min(1).max(2),
      defaultOptionId: z.string().min(1),
      subjectFingerprint: z.string().min(1),
    }).strict(),
  ])
  .superRefine((decision, context) => {
    if (decision.type !== 'requires_approval') return;
    if (!decision.options.some((option) => option.optionId === decision.defaultOptionId)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultOptionId'],
        message: 'Default Approval option must exist.',
      });
    }
    const once = decision.options.filter((option) => option.scope === 'once');
    const session = decision.options.filter((option) => option.scope === 'session');
    if (once.length !== 1 || session.length > 1 || once[0]?.optionId !== decision.defaultOptionId) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Approval options require one default once option and at most one session option.',
      });
    }
  });
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

export const ApprovalSubjectSchema = z
  .object({
    version: z.literal(1),
    toolCallId: z.string().min(1),
    toolIdentity: PermissionToolIdentitySchema,
    criticalInput: JsonValueSchema,
    operations: z.array(PermissionOperationSchema).min(1),
    safetyAssessment: SafetyAssessmentSchema,
    riskFacts: z.record(z.string(), JsonValueSchema),
    fingerprint: z.string().min(1),
  })
  .strict();
export type ApprovalSubject = z.infer<typeof ApprovalSubjectSchema>;

const ApprovalDecisionBaseSchema = z.object({
  approvalRequestId: z.string().min(1),
  decidedBy: z.enum(['user', 'host', 'system']),
  reason: z.string().min(1).optional(),
  decidedAt: z.string().min(1),
});

export const PermissionApprovalDecisionSchema = z.discriminatedUnion('decision', [
  ApprovalDecisionBaseSchema.extend({
    decision: z.literal('approved'),
    optionId: z.string().min(1),
  }).strict(),
  ApprovalDecisionBaseSchema.extend({ decision: z.literal('denied') }).strict(),
]);
export type PermissionApprovalDecision = z.infer<typeof PermissionApprovalDecisionSchema>;

export const ApplyApprovalDecisionRequestSchema = z
  .object({
    originalPermissionDecision: PermissionDecisionSchema,
    originalSubject: ApprovalSubjectSchema,
    currentSubject: ApprovalSubjectSchema,
    decision: PermissionApprovalDecisionSchema,
    sessionId: z.string().min(1).optional(),
    appliedAt: z.string().min(1),
    permissionMode: PermissionModeSchema,
  })
  .strict();
export type ApplyApprovalDecisionRequest = z.infer<typeof ApplyApprovalDecisionRequestSchema>;

export const ApprovalEffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z
    .object({
      type: z.literal('session_tool_grant'),
      rule: PermissionRuleSchema,
    })
    .strict(),
]);
export type ApprovalEffect = z.infer<typeof ApprovalEffectSchema>;

export const ApplyApprovalDecisionResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('applied'),
      effect: ApprovalEffectSchema,
      executionAccess: ToolExecutionAccessSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      reason: z.enum([
        'option_not_found',
        'decision_not_allowed',
        'session_mismatch',
        'subject_invalid',
        'subject_changed',
      ]),
      message: z.string().min(1),
    })
    .strict(),
  z.object({ status: z.literal('failed'), failure: PermissionFailureSchema }).strict(),
]);
export type ApplyApprovalDecisionResult = z.infer<typeof ApplyApprovalDecisionResultSchema>;

export function createApprovalSubject(request: {
  readonly toolCallId: string;
  readonly toolIdentity: PermissionToolIdentity;
  readonly criticalInput: JsonValue;
  readonly operations: readonly PermissionOperation[];
  readonly safetyAssessment: SafetyAssessment;
  readonly riskFacts: JsonObject;
}): ApprovalSubject {
  const content = {
    version: 1 as const,
    toolCallId: request.toolCallId,
    toolIdentity: request.toolIdentity,
    criticalInput: request.criticalInput,
    operations: [...request.operations],
    safetyAssessment: request.safetyAssessment,
    riskFacts: request.riskFacts,
  };
  return deepFreeze({
    ...content,
    fingerprint: fingerprintSubjectContent(content),
  });
}

export function resolveApprovalEffect(
  request: ApplyApprovalDecisionRequest,
): ApplyApprovalDecisionResult {
  if (request.originalPermissionDecision.type !== 'requires_approval') {
    return rejected('decision_not_allowed', 'This Permission decision cannot be approved.');
  }
  if (
    !isValidApprovalSubject(request.originalSubject) ||
    request.originalPermissionDecision.subjectFingerprint !== request.originalSubject.fingerprint ||
    stableSerialize(request.originalPermissionDecision.operations) !==
      stableSerialize(request.originalSubject.operations)
  ) {
    return rejected('subject_invalid', 'The original Approval subject is invalid.');
  }
  if (!isValidApprovalSubject(request.currentSubject)) {
    return rejected('subject_invalid', 'The current Approval subject is invalid.');
  }
  if (
    request.originalSubject.fingerprint !== request.currentSubject.fingerprint ||
    stableSerialize(request.originalSubject) !== stableSerialize(request.currentSubject)
  ) {
    return rejected('subject_changed', 'The Tool Call changed after Approval was requested.');
  }
  const approvalDecision = request.decision;
  if (approvalDecision.decision === 'denied') {
    return { status: 'applied', effect: { type: 'none' } };
  }
  const option = request.originalPermissionDecision.options.find(
    (candidate) => candidate.optionId === approvalDecision.optionId,
  );
  if (!option) return rejected('option_not_found', 'Approval option was not found.');
  const executionAccess = executionAccessFor({
    permissionMode: request.permissionMode,
    operations: request.currentSubject.operations,
    approved: true,
  });
  if (option.effect.type === 'current_tool_call') {
    return { status: 'applied', effect: { type: 'none' }, executionAccess };
  }
  if (
    option.effect.rule.source !== 'session' ||
    option.effect.rule.source_id !== request.sessionId
  ) {
    return rejected('session_mismatch', 'Approval option does not belong to this Session.');
  }
  return {
    status: 'applied',
    effect: { type: 'session_tool_grant', rule: option.effect.rule },
    executionAccess,
  };
}

function isValidApprovalSubject(subject: ApprovalSubject): boolean {
  const parsed = ApprovalSubjectSchema.safeParse(subject);
  if (!parsed.success) return false;
  const { fingerprint: _fingerprint, ...content } = parsed.data;
  return subject.fingerprint === fingerprintSubjectContent(content);
}

function fingerprintSubjectContent(content: Omit<ApprovalSubject, 'fingerprint'>): string {
  const serialized = stableSerialize(content);
  // Fingerprints are change detectors, not authorization secrets. Full subject
  // equality is also checked so hash collisions cannot reuse an Approval.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 0x01000193);
    right ^= code + index;
    right = Math.imul(right, 0x85ebca6b);
  }
  return `permission-subject:v1:${unsignedHex(left)}${unsignedHex(right)}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function unsignedHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function rejected(
  reason: Extract<ApplyApprovalDecisionResult, { status: 'rejected' }>['reason'],
  message: string,
): ApplyApprovalDecisionResult {
  return { status: 'rejected', reason, message };
}

export interface PermissionPolicyResult {
  readonly decision: PermissionDecision;
  readonly approvalSubject: ApprovalSubject;
  readonly executionAccess?: ToolExecutionAccess;
}

export function evaluatePermissionPolicy(request: {
  readonly evaluation: EvaluateToolCallRequest;
  readonly operations: readonly PermissionOperation[];
  readonly criticalInput: EvaluateToolCallRequest['toolInput'];
  readonly riskFacts: JsonObject;
  readonly permissionSettings: PermissionSettings;
}): PermissionPolicyResult {
  const operations = [...request.operations];
  const safetyAssessment = highestSafety(
    operations.map((operation) => assessOperation(operation, request.riskFacts)),
  );
  const safetySummary = safetySummaryFor(safetyAssessment, operations);
  const approvalSubject = createApprovalSubject({
    toolCallId: request.evaluation.toolCallId,
    toolIdentity: operations[0].context.toolIdentity,
    criticalInput: request.criticalInput,
    operations,
    safetyAssessment,
    riskFacts: request.riskFacts,
  });
  const settings = {
    ...request.permissionSettings,
    mode: request.evaluation.permissionMode,
  };

  if (matchesAny(settings.deny, operations)) {
    return {
      approvalSubject,
      decision: {
        type: 'deny',
        operations,
        safetyAssessment,
        safetySummary,
        reason: 'Denied by an explicit Permission rule.',
        denialCode: 'rule_denied',
      },
    };
  }
  if (matchesAny(settings.ask, operations)) {
    return {
      approvalSubject,
      decision: approvalDecision({
        evaluation: request.evaluation,
        operations,
        safetyAssessment,
        safetySummary,
        approvalSubject,
        reason: 'Approval required by an explicit Permission rule.',
      }),
    };
  }

  const allExplicitlyAllowed = operations.every((operation) =>
    settings.allow.some((rule) => matchesPermissionRule(rule, operation)),
  );
  if (allExplicitlyAllowed) {
    return {
      approvalSubject,
      decision: {
        type: 'allow',
        operations,
        safetyAssessment,
        safetySummary,
        reason: 'Allowed by an explicit Permission rule.',
      },
      executionAccess: executionAccessFor({ permissionMode: settings.mode, operations }),
    };
  }

  const allowByMode =
    settings.mode === 'full_access' ||
    (settings.mode === 'auto' && safetyAssessment === 'safe') ||
    (settings.mode === 'ask' && operations.every(isAskModeImplicitlySafe));
  return allowByMode
    ? {
        approvalSubject,
        decision: {
          type: 'allow',
          operations,
          safetyAssessment,
          safetySummary,
          reason: `Allowed by ${settings.mode} mode.`,
        },
        executionAccess: executionAccessFor({ permissionMode: settings.mode, operations }),
      }
    : {
        approvalSubject,
        decision: approvalDecision({
          evaluation: request.evaluation,
          operations,
          safetyAssessment,
          safetySummary,
          approvalSubject,
          reason: `Approval required by ${settings.mode} mode.`,
        }),
      };
}

function assessOperation(operation: PermissionOperation, riskFacts: JsonObject): SafetyAssessment {
  if (operation.action === 'agent.context.activate') return 'safe';
  if (operation.action === 'external.invoke') return 'prohibited';
  if (operation.action === 'workspace.read' || operation.action === 'workspace.write') {
    const path = operation.resource?.attributes ?? objectFact(riskFacts.path);
    if (!path || path.classified !== true) return 'prohibited';
    return path.insideWorkspace === true && path.protected !== true && path.sensitive !== true
      ? 'safe'
      : 'prohibited';
  }
  if (operation.action === 'network.search') return 'safe';
  if (operation.action === 'network.fetch') {
    const network = objectFact(riskFacts.network);
    return network?.valid === true ? 'safe' : 'prohibited';
  }
  if (operation.action === 'process.execute') {
    const shell = objectFact(riskFacts.shell);
    const classification = shell?.classification;
    if (
      classification === 'destructive' ||
      classification === 'infrastructure_or_deploy' ||
      classification === 'secret_or_env' ||
      classification === 'nested_shell' ||
      classification === 'unknown_shell'
    ) {
      return 'prohibited';
    }
    if (
      classification === 'read_only' ||
      classification === 'verification' ||
      classification === 'search_or_list' ||
      classification === 'git_read'
    ) {
      return 'safe';
    }
    return 'potentially_unsafe';
  }
  return 'prohibited';
}

function approvalDecision(request: {
  readonly evaluation: EvaluateToolCallRequest;
  readonly operations: PermissionOperation[];
  readonly safetyAssessment: SafetyAssessment;
  readonly safetySummary: string;
  readonly approvalSubject: ApprovalSubject;
  readonly reason: string;
}): PermissionDecision {
  const highRisk = request.safetyAssessment === 'prohibited';
  const options: ApprovalOption[] = [
    {
      optionId: `once:${request.evaluation.toolCallId}`,
      scope: 'once',
      display: {
        label: highRisk ? 'Allow once (high risk)' : 'Once',
        description: highRisk
          ? 'This target is outside the normal safety boundary. Allow only this Tool Call.'
          : 'Allow only this Tool Call.',
      },
      effect: { type: 'current_tool_call' },
    },
  ];
  const sessionOperation = sessionGrantOperation(request);
  if (sessionOperation?.resource?.id) {
    options.push({
      optionId: `session:${request.evaluation.toolCallId}:${sessionOperation.resource.id}`,
      scope: 'session',
      display: {
        label: 'Session',
        description: 'Allow this read operation for the same Workspace path during this Session.',
      },
      effect: {
        type: 'session_tool_grant',
        rule: {
          source: 'session',
          source_id: request.evaluation.sessionId,
          target: {
            kind: 'operation',
            action: sessionOperation.action,
            resource: {
              type: sessionOperation.resource.type,
              matcher: { operator: 'exact', value: sessionOperation.resource.id },
            },
          },
        },
      },
    });
  }
  return {
    type: 'requires_approval',
    operations: request.operations,
    safetyAssessment: request.safetyAssessment,
    safetySummary: request.safetySummary,
    reason: request.reason,
    options,
    defaultOptionId: options[0].optionId,
    subjectFingerprint: request.approvalSubject.fingerprint,
  };
}

function sessionGrantOperation(request: {
  readonly evaluation: EvaluateToolCallRequest;
  readonly operations: readonly PermissionOperation[];
  readonly safetyAssessment: SafetyAssessment;
}): PermissionOperation | undefined {
  const identity = request.operations[0]?.context.toolIdentity;
  if (
    !request.evaluation.sessionId ||
    request.safetyAssessment !== 'safe' ||
    request.operations.length !== 1 ||
    request.operations[0].action !== 'workspace.read' ||
    identity?.sourceId !== 'built_in' ||
    identity.namespace !== 'megumi' ||
    identity.sourceToolName !== 'read_file' ||
    identity.registeredToolName !== 'read_file'
  )
    return undefined;
  return request.operations[0];
}

function matchesAny(
  rules: readonly PermissionRule[],
  operations: readonly PermissionOperation[],
): boolean {
  return rules.some((rule) =>
    operations.some((operation) => matchesPermissionRule(rule, operation)),
  );
}

function highestSafety(values: readonly SafetyAssessment[]): SafetyAssessment {
  if (values.includes('prohibited')) return 'prohibited';
  if (values.includes('potentially_unsafe')) return 'potentially_unsafe';
  return 'safe';
}

function safetySummaryFor(
  safetyAssessment: SafetyAssessment,
  operations: readonly PermissionOperation[],
): string {
  const actionNames = [...new Set(operations.map((operation) => operation.action))].join(', ');
  if (safetyAssessment === 'safe') return `Known low-risk operation: ${actionNames}.`;
  if (safetyAssessment === 'potentially_unsafe') {
    return `Operation may cause external or mutable effects: ${actionNames}.`;
  }
  return `Operation is outside the normal safety boundary: ${actionNames}.`;
}

function isAskModeImplicitlySafe(operation: PermissionOperation): boolean {
  return operation.action === 'workspace.read' || operation.action === 'agent.context.activate';
}

function objectFact(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
