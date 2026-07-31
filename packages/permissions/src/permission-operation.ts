/*
 * Resolves trusted Tool Call facts into stable Permission Operations and objective risk facts.
 */
import { z } from 'zod';
import type { JsonObject, JsonValue, RegisteredTool } from '@megumi/tools';
import {
  JsonValueSchema,
  PermissionActionIdSchema,
  PermissionFailureSchema,
  PermissionModeSchema,
  PermissionResourceTypeSchema,
  type PermissionFailure,
  type PermissionMode,
} from './permission-rules';
import { classifyShellCommand, type ShellCommandAssessment } from './shell-command';

export const PermissionToolIdentitySchema = z.object({
  sourceId: z.string().min(1),
  namespace: z.string().min(1),
  sourceToolName: z.string().min(1),
  registeredToolName: z.string().min(1),
}).strict();
export type PermissionToolIdentity = z.infer<typeof PermissionToolIdentitySchema>;

export const PermissionOperationSchema = z.object({
  action: PermissionActionIdSchema,
  resource: z.object({
    type: PermissionResourceTypeSchema,
    id: z.string().min(1).optional(),
    attributes: z.record(z.string(), JsonValueSchema).optional(),
  }).strict().optional(),
  context: z.object({
    workspaceId: z.string().min(1),
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    toolIdentity: PermissionToolIdentitySchema,
  }).strict(),
}).strict().superRefine((operation, context) => {
  const expected: Record<z.infer<typeof PermissionActionIdSchema>, z.infer<typeof PermissionResourceTypeSchema> | undefined> = {
    'workspace.read': 'workspace.path',
    'workspace.write': 'workspace.path',
    'process.execute': 'process.command',
    'network.search': 'network.public_web',
    'network.fetch': 'network.url',
    'agent.context.activate': undefined,
    'external.invoke': 'tool.identity',
  };
  if (operation.resource && operation.resource.type !== expected[operation.action]) {
    context.addIssue({
      code: 'custom', path: ['resource'], message: `${operation.action} only supports ${expected[operation.action] ?? 'no resource'}`,
    });
  }
});
export type PermissionOperation = z.infer<typeof PermissionOperationSchema>;

export interface WorkspacePathPermissionFacts {
  readonly absolutePath: string;
  readonly workspacePath: string;
  readonly insideWorkspace: boolean;
  readonly protected: boolean;
  readonly sensitive: boolean;
}

export type ClassifyPermissionWorkspacePathResult =
  | { readonly status: 'classified'; readonly workspacePath: WorkspacePathPermissionFacts }
  | { readonly status: 'failed'; readonly failure: PermissionFailure };

export interface PermissionWorkspacePathClassifier {
  classifyWorkspacePath(request: {
    readonly workspaceId: string;
    readonly targetPath: string;
  }): ClassifyPermissionWorkspacePathResult | Promise<ClassifyPermissionWorkspacePathResult>;
}

export interface EvaluateToolCallRequest {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly toolCallId: string;
  readonly toolInput: JsonValue;
  readonly registeredTool: RegisteredTool;
  readonly permissionMode: PermissionMode;
  readonly evaluatedAt: string;
}

export const EvaluateToolCallRequestSchema: z.ZodType<EvaluateToolCallRequest> = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolInput: JsonValueSchema,
  registeredTool: z.custom<RegisteredTool>(isRegisteredTool, 'Invalid registered Tool facts.'),
  permissionMode: PermissionModeSchema,
  evaluatedAt: z.string().min(1),
}).strict();

export interface ResolvedPermissionOperations {
  readonly operations: readonly PermissionOperation[];
  readonly criticalInput: JsonValue;
  readonly riskFacts: JsonObject;
}

const PATH_ACTIONS: Record<string, 'workspace.read' | 'workspace.write'> = {
  read_file: 'workspace.read',
  list_directory: 'workspace.read',
  glob: 'workspace.read',
  search_text: 'workspace.read',
  write_file: 'workspace.write',
  edit_file: 'workspace.write',
};

export function resolveWorkspacePathTarget(request: EvaluateToolCallRequest): string | undefined {
  const builtInName = trustedBuiltInName(request.registeredTool);
  return builtInName && PATH_ACTIONS[builtInName]
    ? readString(request.toolInput, ['path', 'targetPath', 'target_path', 'workspacePath', 'workspace_path'])
    : undefined;
}

export function resolvePermissionOperations(request: {
  readonly evaluation: EvaluateToolCallRequest;
  readonly workspacePath?: WorkspacePathPermissionFacts;
}): ResolvedPermissionOperations {
  const evaluation = request.evaluation;
  const tool = evaluation.registeredTool;
  const builtInName = trustedBuiltInName(tool);
  const toolIdentity: PermissionToolIdentity = {
    sourceId: tool.identity.sourceId,
    namespace: tool.identity.namespace,
    sourceToolName: tool.identity.sourceToolName,
    registeredToolName: tool.registeredToolName,
  };
  const context: PermissionOperation['context'] = {
    workspaceId: evaluation.workspaceId,
    sessionId: evaluation.sessionId,
    runId: evaluation.runId,
    toolIdentity,
  };
  const commonRiskFacts: JsonObject = {
    toolSideEffect: tool.definition.sideEffect,
    toolCapabilities: [...tool.definition.capabilities],
  };
  const criticalInput = normalizeJsonValue(evaluation.toolInput);

  const pathAction = builtInName ? PATH_ACTIONS[builtInName] : undefined;
  if (pathAction) {
    const workspacePath = request.workspacePath;
    const id = workspacePath
      ? (workspacePath.insideWorkspace ? workspacePath.workspacePath : workspacePath.absolutePath)
      : resolveWorkspacePathTarget(evaluation);
    return {
      operations: [{
        action: pathAction,
        resource: { type: 'workspace.path', ...(id ? { id } : {}) },
        context,
      }],
      criticalInput,
      riskFacts: {
        ...commonRiskFacts,
        path: workspacePath ? workspacePathRiskFacts(workspacePath) : { classified: false },
      },
    };
  }

  if (builtInName === 'run_command') {
    const command = readString(evaluation.toolInput, ['command']) ?? '';
    const shellAssessment = classifyShellCommand({
      command,
      shellKind: trustedShellKind(tool),
    });
    return {
      operations: [{
        action: 'process.execute',
        resource: {
          type: 'process.command',
          ...(shellAssessment.normalizedCommand ? { id: shellAssessment.normalizedCommand } : {}),
          attributes: {
            shellKind: shellAssessment.shellKind,
            classification: shellAssessment.classification,
            hasControlOperator: shellAssessment.hasControlOperator,
            hasRedirection: shellAssessment.hasRedirection,
          },
        },
        context,
      }],
      criticalInput,
      riskFacts: {
        ...commonRiskFacts,
        shell: shellRiskFacts(shellAssessment),
      },
    };
  }

  if (builtInName === 'web_search') {
    return {
      operations: [{ action: 'network.search', resource: { type: 'network.public_web' }, context }],
      criticalInput,
      riskFacts: { ...commonRiskFacts, network: { kind: 'publicWebSearch' } },
    };
  }

  if (builtInName === 'web_fetch') {
    const url = normalizeUrl(readString(evaluation.toolInput, ['url']));
    return {
      operations: [{
        action: 'network.fetch',
        resource: {
          type: 'network.url',
          ...(url ? { id: url.id, attributes: { hostname: url.hostname } } : {}),
        },
        context,
      }],
      criticalInput,
      riskFacts: {
        ...commonRiskFacts,
        network: url
          ? { kind: 'url', valid: true, hostname: url.hostname }
          : { kind: 'url', valid: false },
      },
    };
  }

  if (builtInName === 'use_skill') {
    return {
      operations: [{ action: 'agent.context.activate', context }],
      criticalInput,
      riskFacts: commonRiskFacts,
    };
  }

  const stableId = `${tool.identity.sourceId}/${tool.identity.namespace}/${tool.identity.sourceToolName}`;
  return {
    operations: [{
      action: 'external.invoke',
      resource: { type: 'tool.identity', id: stableId },
      context,
    }],
    criticalInput,
    riskFacts: { ...commonRiskFacts, trustedOperationResolver: false },
  };
}

function trustedBuiltInName(tool: RegisteredTool): string | undefined {
  if (tool.source.sourceKind !== 'built_in'
    || tool.source.sourceId !== 'built_in'
    || tool.source.namespace !== 'megumi'
    || tool.identity.sourceId !== tool.source.sourceId
    || tool.identity.namespace !== tool.source.namespace
    || tool.identity.sourceToolName !== tool.definition.name
    || tool.registeredToolName !== tool.definition.name) {
    return undefined;
  }
  const ruleToolName = tool.definition.permissionMetadata?.ruleToolName;
  return typeof ruleToolName === 'string' && ruleToolName === tool.definition.name
    ? ruleToolName
    : undefined;
}

function trustedShellKind(tool: RegisteredTool): 'powershell' | 'cmd' | 'posix_shell' | 'unknown' {
  const value = tool.definition.permissionMetadata?.shellKind;
  return value === 'powershell' || value === 'cmd' || value === 'posix_shell' ? value : 'unknown';
}

function readString(input: JsonValue, fields: readonly string[]): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  for (const field of fields) {
    const value = input[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeUrl(value: string | undefined): { id: string; hostname: string } | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return { id: url.toString(), hostname: url.hostname.toLowerCase().replace(/\.$/, '') };
  } catch {
    return undefined;
  }
}

function normalizeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJsonValue(item)]),
    );
  }
  return value;
}

function workspacePathRiskFacts(path: WorkspacePathPermissionFacts): JsonObject {
  return {
    classified: true,
    absolutePath: path.absolutePath,
    workspacePath: path.workspacePath,
    insideWorkspace: path.insideWorkspace,
    protected: path.protected,
    sensitive: path.sensitive,
  };
}

function shellRiskFacts(assessment: ShellCommandAssessment): JsonObject {
  return {
    shellKind: assessment.shellKind,
    classification: assessment.classification,
    normalizedCommand: assessment.normalizedCommand,
    segments: [...assessment.segments],
    hasControlOperator: assessment.hasControlOperator,
    hasRedirection: assessment.hasRedirection,
  };
}

function isRegisteredTool(value: unknown): value is RegisteredTool {
  if (!value || typeof value !== 'object') return false;
  const tool = value as Partial<RegisteredTool>;
  return tool.status === 'available'
    && typeof tool.registeredToolName === 'string'
    && tool.registeredToolName.length > 0
    && Boolean(tool.identity
      && typeof tool.identity.sourceId === 'string'
      && typeof tool.identity.namespace === 'string'
      && typeof tool.identity.sourceToolName === 'string')
    && Boolean(tool.source
      && typeof tool.source.sourceId === 'string'
      && typeof tool.source.sourceKind === 'string'
      && typeof tool.source.namespace === 'string')
    && Boolean(tool.definition
      && typeof tool.definition.name === 'string'
      && typeof tool.definition.sideEffect === 'string'
      && Array.isArray(tool.definition.capabilities));
}

export { PermissionFailureSchema };
