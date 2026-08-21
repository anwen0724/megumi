/*
 * Validates Tool-supplied operation facts and enriches them with Permission-owned
 * path and command safety facts before policy evaluation.
 */
import { z } from 'zod';
import { JsonValueSchema, type JsonObject, type JsonValue } from './json';
import {
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
    executionId: z.string().min(1),
    toolIdentity: PermissionToolIdentitySchema,
  }).strict(),
}).strict().superRefine((operation, context) => {
  const expected: Record<
    z.infer<typeof PermissionActionIdSchema>,
    z.infer<typeof PermissionResourceTypeSchema> | undefined
  > = {
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
      code: 'custom',
      path: ['resource'],
      message: `${operation.action} only supports ${expected[operation.action] ?? 'no resource'}`,
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
  readonly executionId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly toolCallId: string;
  readonly toolInput: JsonValue;
  readonly operations: readonly PermissionOperation[];
  readonly permissionMode: PermissionMode;
  readonly evaluatedAt: string;
}

export const EvaluateToolCallRequestSchema: z.ZodType<EvaluateToolCallRequest> = z.object({
  executionId: z.string().min(1),
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolInput: JsonValueSchema,
  operations: z.array(PermissionOperationSchema).min(1),
  permissionMode: PermissionModeSchema,
  evaluatedAt: z.string().min(1),
}).strict();

export interface ResolvedPermissionOperations {
  readonly operations: readonly PermissionOperation[];
  readonly criticalInput: JsonValue;
  readonly riskFacts: JsonObject;
}

interface WorkspacePathTarget {
  readonly key: string;
  readonly operationIndex: number;
  readonly path: string;
}

export function resolveWorkspacePathTargets(
  request: EvaluateToolCallRequest,
): readonly WorkspacePathTarget[] {
  return request.operations.flatMap((operation, operationIndex) => (
    (operation.action === 'workspace.read' || operation.action === 'workspace.write')
      && operation.resource?.type === 'workspace.path'
      && operation.resource.id
      ? [{ key: String(operationIndex), operationIndex, path: operation.resource.id }]
      : []
  ));
}

export function resolveWorkspacePathTarget(
  request: EvaluateToolCallRequest,
): string | undefined {
  return resolveWorkspacePathTargets(request)[0]?.path;
}

export function resolvePermissionOperations(request: {
  readonly evaluation: EvaluateToolCallRequest;
  readonly workspacePaths?: Readonly<Record<string, WorkspacePathPermissionFacts>>;
}): ResolvedPermissionOperations {
  const operations = request.evaluation.operations.map((operation, index) => (
    enrichNetworkOperation(enrichOperation(operation, request.workspacePaths?.[String(index)]))
  ));
  const shellOperation = operations.find((operation) => operation.action === 'process.execute');
  const shellAssessment = shellOperation ? assessShellOperation(shellOperation) : undefined;
  const pathFacts = Object.fromEntries(
    resolveWorkspacePathTargets(request.evaluation).map((target) => [
      target.key,
      request.workspacePaths?.[target.key]
        ? workspacePathRiskFacts(request.workspacePaths[target.key])
        : { classified: false },
    ]),
  );
  const networkFetch = operations.find((operation) => operation.action === 'network.fetch');
  const networkUrl = networkFetch?.resource?.id
    ? normalizeUrl(networkFetch.resource.id)
    : undefined;

  return {
    operations: shellAssessment
      ? operations.map((operation) => (
          operation === shellOperation ? enrichShellOperation(operation, shellAssessment) : operation
        ))
      : operations,
    criticalInput: normalizeJsonValue(request.evaluation.toolInput),
    riskFacts: {
      operations: operations.map((operation) => ({
        action: operation.action,
        resourceType: operation.resource?.type ?? null,
      })),
      ...(Object.keys(pathFacts).length > 0 ? {
        paths: pathFacts,
        ...(Object.keys(pathFacts).length === 1 ? { path: Object.values(pathFacts)[0] } : {}),
      } : {}),
      ...(shellAssessment ? { shell: shellRiskFacts(shellAssessment) } : {}),
      ...(networkFetch ? {
        network: networkUrl
          ? { kind: 'url', valid: true, hostname: networkUrl.hostname }
          : { kind: 'url', valid: false },
      } : {}),
    },
  };
}

function enrichOperation(
  operation: PermissionOperation,
  pathFacts: WorkspacePathPermissionFacts | undefined,
): PermissionOperation {
  if ((operation.action !== 'workspace.read' && operation.action !== 'workspace.write')
    || operation.resource?.type !== 'workspace.path') return operation;
  const id = pathFacts
    ? (pathFacts.insideWorkspace ? pathFacts.workspacePath : pathFacts.absolutePath)
    : operation.resource.id;
  return {
    ...operation,
    resource: {
      ...operation.resource,
      ...(id ? { id } : {}),
      attributes: {
        ...operation.resource.attributes,
        classified: Boolean(pathFacts),
        ...(pathFacts ? {
          insideWorkspace: pathFacts.insideWorkspace,
          protected: pathFacts.protected,
          sensitive: pathFacts.sensitive,
        } : {}),
      },
    },
  };
}

function assessShellOperation(operation: PermissionOperation): ShellCommandAssessment {
  const shellKind = operation.resource?.attributes?.shellKind;
  return classifyShellCommand({
    command: operation.resource?.id ?? '',
    shellKind: shellKind === 'powershell' || shellKind === 'cmd' || shellKind === 'posix_shell'
      ? shellKind
      : 'unknown',
  });
}

function enrichShellOperation(
  operation: PermissionOperation,
  assessment: ShellCommandAssessment,
): PermissionOperation {
  if (operation.resource?.type !== 'process.command') return operation;
  return {
    ...operation,
    resource: {
      ...operation.resource,
      ...(assessment.normalizedCommand ? { id: assessment.normalizedCommand } : {}),
      attributes: {
        ...operation.resource.attributes,
        shellKind: assessment.shellKind,
        classification: assessment.classification,
        hasControlOperator: assessment.hasControlOperator,
        hasRedirection: assessment.hasRedirection,
      },
    },
  };
}

function enrichNetworkOperation(operation: PermissionOperation): PermissionOperation {
  if (operation.action !== 'network.fetch'
    || operation.resource?.type !== 'network.url'
    || !operation.resource.id) return operation;
  const normalized = normalizeUrl(operation.resource.id);
  if (!normalized) return operation;
  return {
    ...operation,
    resource: {
      ...operation.resource,
      id: normalized.url,
      attributes: {
        ...operation.resource.attributes,
        hostname: normalized.hostname,
      },
    },
  };
}

function normalizeUrl(value: string): { readonly url: string; readonly hostname: string } | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return { url: url.toString(), hostname: url.hostname };
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
