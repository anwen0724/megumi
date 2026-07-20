/* Runs a real Product Host lifecycle, including approvals, limits, reconciliation, and cleanup. */
import { cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProductHostInterface } from '@megumi/product/host-interface';
import type { RuntimeEvent } from '@megumi/product/runtime-events';
import type { EvaluationCase } from '../cases/evaluation-case';
import type { EvaluationIsolation, ExecutionProfile } from '../config/execution-profile';
import type { EvaluationTarget } from '../config/evaluation-target';
import { createScopedWorkspaceFileSystem } from '../adapters/scoped-workspace-file-system';
import {
  digestOwnedFile,
  readBoundedOwnedText,
  resolveOwnedWorkspacePath,
} from '../adapters/scoped-workspace-file-system';
import { preflightEvaluationEnvironment } from './environment-preflight';
import type { EvaluationDiagnostic, EvaluationExecution } from './evaluation-contracts';
import type { EvaluationEvidence } from './evaluation-contracts';
import { collectEvaluationEvidence } from './evidence-collector';

type EvaluationHost = {
  workspace: Pick<ProductHostInterface['workspace'], 'useExistingProject'>;
  chat: Pick<ProductHostInterface['chat'], 'createSession' | 'sendUserInput' | 'cancelUserInput' | 'listMessages' | 'listTimeline'>;
  approval: Pick<ProductHostInterface['approval'], 'resolve'>;
  settings: Pick<ProductHostInterface['settings'], 'get'>;
  skill: Pick<ProductHostInterface['skill'], 'listSkills'>;
  observability: Pick<ProductHostInterface['observability'], 'getRunTrace'>;
};

export interface EvaluationProductRuntime {
  host: EvaluationHost;
  observability: { flush(): Promise<void> };
  dispose(): void | Promise<void>;
}

export interface EvaluationRuntimeFactoryInput {
  homeRoot: string;
  workspaceRoot: string;
  target: EvaluationTarget;
  profile: ExecutionProfile;
  toolFileSystem: Awaited<ReturnType<typeof createScopedWorkspaceFileSystem>>;
  isBuiltInToolAvailable(toolName: string): boolean;
}

export interface EvaluationProductRuntimeFactory {
  create(input: EvaluationRuntimeFactoryInput): Promise<EvaluationProductRuntime>;
}

export interface RunEvaluationAttemptInput {
  suiteId: string;
  repetition: number;
  evaluationCase: EvaluationCase;
  target: EvaluationTarget;
  profile: ExecutionProfile;
  runtimeFactory: EvaluationProductRuntimeFactory;
  availableIsolation: EvaluationIsolation[];
  fixtureDirectory?: string;
  temporaryRoot?: string;
  retainEnvironment?: boolean;
}

export interface EvaluationAttemptResult {
  execution: EvaluationExecution;
  outcome: 'terminal' | 'unexpected_approval' | 'limit_reached' | 'setup_failed' | 'runner_failed';
  terminalEvent?: RuntimeEvent;
  runtimeEvents: RuntimeEvent[];
  workspaceId?: string;
  sessionId?: string;
  runId?: string;
  session: { messages: unknown[]; timeline: unknown[] };
  evidence: EvaluationEvidence;
  runtimeFacts: {
    relevantSettings: unknown;
    toolCatalog: unknown[];
    skillCatalog: unknown[];
  };
  retainedEnvironmentPath?: string;
}

export async function runEvaluationAttempt(input: RunEvaluationAttemptInput): Promise<EvaluationAttemptResult> {
  const startedAt = new Date().toISOString();
  const diagnostics: EvaluationDiagnostic[] = [];
  const execution: EvaluationExecution = {
    executionId: randomUUID(),
    suiteId: input.suiteId,
    caseId: input.evaluationCase.caseId,
    targetId: input.target.targetId,
    executionProfileId: input.profile.profileId,
    repetition: input.repetition,
    startedAt,
    status: 'runner_failed',
    diagnostics,
  };
  const evaluationRoot = await mkdtemp(path.join(input.temporaryRoot ?? tmpdir(), 'megumi-evaluation-'));
  const homeRoot = path.join(evaluationRoot, 'home');
  const workspaceRoot = path.join(evaluationRoot, 'workspace');
  const outputRoot = path.join(evaluationRoot, 'output');
const runtimeEvents: RuntimeEvent[] = [];
  const session = { messages: [] as unknown[], timeline: [] as unknown[] };
  let evidence = unavailableEvidence(execution.executionId);
  const runtimeFacts = { relevantSettings: 'unavailable' as unknown, toolCatalog: [] as unknown[], skillCatalog: [] as unknown[] };
  let runtime: EvaluationProductRuntime | undefined;
  let workspaceId: string | undefined;
  let sessionId: string | undefined;
  let runId: string | undefined;
  let terminalEvent: RuntimeEvent | undefined;
  let outcome: EvaluationAttemptResult['outcome'] = 'runner_failed';

  if (input.retainEnvironment) {
    diagnostics.push({
      code: 'environment_retained',
      message: `Evaluation environment retained at ${evaluationRoot}. It may contain private task data and must be removed manually.`,
      source: 'cleanup',
    });
  }

  try {
    try {
      await mkdir(homeRoot, { recursive: true });
      await mkdir(workspaceRoot, { recursive: true });
      await mkdir(outputRoot, { recursive: true });
      if (input.fixtureDirectory) await cp(input.fixtureDirectory, workspaceRoot, { recursive: true, force: true });
    } catch (error) {
      throw new SetupError(`Evaluation fixture or temporary environment setup failed: ${errorMessage(error)}`);
    }
    const declaredWorkspacePaths = graderWorkspacePaths(input.evaluationCase);
    const toolFileSystem = await createScopedWorkspaceFileSystem(workspaceRoot);
    const initialWorkspaceFiles = await snapshotWorkspaceFiles(workspaceRoot, declaredWorkspacePaths);
    const enabled = input.profile.enabledTools ? new Set(input.profile.enabledTools) : undefined;
    try {
      runtime = await input.runtimeFactory.create({
        homeRoot,
        workspaceRoot,
        target: input.target,
        profile: input.profile,
        toolFileSystem,
        isBuiltInToolAvailable: (toolName) => enabled?.has(toolName) ?? true,
      });
    } catch (error) {
      throw new SetupError(`Product runtime setup failed: ${errorMessage(error)}`);
    }

    try {
      const settings = await runtime.host.settings.get();
      if (settings.status === 'ok') {
        runtimeFacts.relevantSettings = stableRuntimeFact(settings.settings, homeRoot, workspaceRoot);
        runtimeFacts.toolCatalog = stableRuntimeFact(settings.settings.permissions.catalog.tools, homeRoot, workspaceRoot) as unknown[];
      }
    } catch {
      // Unavailable runtime facts remain explicit in the fingerprint input.
    }

    const resolvedTools = runtimeFacts.toolCatalog.flatMap((item) => {
      const name = (item as { registeredToolName?: unknown }).registeredToolName;
      return typeof name === 'string' ? [name] : [];
    });
    const preflight = preflightEvaluationEnvironment({
      evaluationCase: input.evaluationCase,
      profile: input.profile,
      resolvedTools,
      availableIsolation: input.availableIsolation,
    });
    if (preflight.status === 'setup_failed') {
      diagnostics.push(...preflight.issues.map((message) => ({ code: 'environment_preflight_failed', message, source: 'setup' as const })));
      execution.status = 'setup_failed';
      outcome = 'setup_failed';
      return finish();
    }

    const opened = await runtime.host.workspace.useExistingProject();
    if (opened.status !== 'opened') throw new SetupError(`Evaluation workspace could not be opened: ${opened.status}`);
    workspaceId = opened.project.projectId;
    try {
      const skills = await runtime.host.skill.listSkills({ workspaceId });
      if (skills.status === 'ok') runtimeFacts.skillCatalog = stableRuntimeFact(skills.skills, homeRoot, workspaceRoot) as unknown[];
    } catch {
      // Skill catalog availability is recorded as an empty resolved input.
    }
    const created = await runtime.host.chat.createSession({ projectId: workspaceId, title: input.evaluationCase.name });
    if (created.status !== 'created') throw new SetupError(`Evaluation session could not be created: ${created.failure.message}`);
    sessionId = created.session.id;
    const attachments = await prepareEvaluationAttachments(input.evaluationCase, workspaceRoot);

    const invocation = await runtime.host.chat.sendUserInput({
      projectId: workspaceId,
      sessionId,
      text: input.evaluationCase.request.text,
      ...(attachments.length > 0 ? { attachments } : {}),
      modelSelection: { provider_id: input.target.providerId, model_id: input.target.modelId },
      permissionMode: input.profile.permissionMode,
      permissionSource: `evaluation:${input.profile.profileId}`,
    });
    if (invocation.payload.type !== 'agent_run' || !invocation.events) {
      throw new SetupError(`Product did not start the expected Agent Run: ${invocation.payload.type}`);
    }
    runId = invocation.payload.run.runId;

    const state: StreamState = {
      deadlineAt: Date.now() + input.profile.limits.wallClockMs,
      events: runtimeEvents,
      eventsTruncated: false,
      approvals: [],
      modelCalls: 0,
      toolCalls: 0,
      limits: input.profile.limits,
    };

    try {
      terminalEvent = await consumeRuntimeStream(invocation.events, state) ?? terminalEvent;
      const approvalMatcher = createApprovalScriptMatcher(input.evaluationCase);
      while (!terminalEvent && state.approvals.length > 0) {
        const approvalEvent = state.approvals.shift()!;
        const resolution = approvalMatcher.resolve(approvalEvent);
        if (resolution.status === 'unmatched') {
          await cancelAndConsume(runtime.host, runId, state);
          diagnostics.push({ code: 'unexpected_approval', message: resolution.message, source: 'runner' });
          execution.status = 'completed';
          outcome = 'unexpected_approval';
          break;
        }
        const resumed = await runtime.host.approval.resolve(resolution.payload);
        if (resumed.payload.status !== 'resumed') {
          throw new RunnerError(`Approval continuation failed: ${resumed.payload.status}`);
        }
        if (!resumed.events) throw new RunnerError('Approval resumed without a continuation event stream.');
        terminalEvent = await consumeRuntimeStream(resumed.events, state) ?? terminalEvent;
      }

      if (!terminalEvent && outcome !== 'unexpected_approval') {
        diagnostics.push({
          code: 'event_stream_missing_terminal',
          message: 'Runtime event streams ended without a terminal event.',
          source: 'runner',
        });
        execution.status = 'runner_failed';
        outcome = 'runner_failed';
      } else if (terminalEvent) {
        execution.status = 'completed';
        outcome = 'terminal';
      }
    } catch (error) {
      if (error instanceof EvaluationLimitError) {
        await cancelAndConsume(runtime.host, runId, state);
        diagnostics.push({ code: error.code, message: error.message, source: 'runner' });
        execution.status = 'completed';
        outcome = 'limit_reached';
      } else {
        throw error;
      }
    }

    const messages = await runtime.host.chat.listMessages({ sessionId });
    if (messages.status === 'ok') session.messages = messages.messages;
    else diagnostics.push({ code: 'session_reconciliation_failed', message: messages.failure.message, source: 'runner' });
    const timeline = await runtime.host.chat.listTimeline({ projectId: workspaceId, sessionId, ...(runId ? { runId } : {}) });
    session.timeline = timeline.messages;
    try {
      await runtime.observability.flush();
    } catch (error) {
      diagnostics.push({ code: 'observability_flush_failed', message: errorMessage(error), source: 'observability' });
    }
    evidence = await collectEvaluationEvidence({
      workspaceRoot,
      declaredWorkspacePaths,
      sessionId,
      messages: session.messages,
      timeline: session.timeline,
      runtimeEvents,
      runtimeEventsComplete: Boolean(terminalEvent) || outcome === 'unexpected_approval' || outcome === 'limit_reached',
      runtimeEventsTruncated: state.eventsTruncated,
      runId,
      observabilityHost: runtime.host.observability,
      initialWorkspaceFiles,
    });
    return finish();
  } catch (error) {
    if (error instanceof SetupError) {
      execution.status = 'setup_failed';
      outcome = 'setup_failed';
      diagnostics.push({ code: 'setup_failed', message: error.message, source: 'setup' });
    } else {
      execution.status = 'runner_failed';
      outcome = 'runner_failed';
      diagnostics.push({ code: 'runner_failed', message: errorMessage(error), source: 'runner' });
    }
    return finish();
  } finally {
    try {
      await runtime?.dispose();
    } catch (error) {
      diagnostics.push({ code: 'product_dispose_failed', message: errorMessage(error), source: 'cleanup' });
    }
    if (!input.retainEnvironment) {
      try {
        await rm(evaluationRoot, { recursive: true, force: true });
      } catch (error) {
        diagnostics.push({ code: 'environment_cleanup_failed', message: errorMessage(error), source: 'cleanup' });
      }
    }
  }

  function finish(): EvaluationAttemptResult {
    execution.completedAt = new Date().toISOString();
    execution.correlation = {
      ...(workspaceId ? { workspaceId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(runId ? { runId } : {}),
    };
    return {
      execution,
      outcome,
      ...(terminalEvent ? { terminalEvent } : {}),
      runtimeEvents,
      ...(workspaceId ? { workspaceId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(runId ? { runId } : {}),
      session,
      evidence,
      runtimeFacts,
      ...(input.retainEnvironment ? { retainedEnvironmentPath: evaluationRoot } : {}),
    };
  }
}

function stableRuntimeFact(value: unknown, homeRoot: string, workspaceRoot: string): unknown {
  if (typeof value === 'string') {
    return replacePathPrefix(replacePathPrefix(value, homeRoot, '<evaluation-home>'), workspaceRoot, '<evaluation-workspace>');
  }
  if (Array.isArray(value)) return value.map((item) => stableRuntimeFact(item, homeRoot, workspaceRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stableRuntimeFact(item, homeRoot, workspaceRoot)]));
  }
  return value;
}

function replacePathPrefix(value: string, root: string, marker: string): string {
  const normalizedValue = value.replace(/\\/g, '/');
  const normalizedRoot = path.resolve(root).replace(/\\/g, '/');
  const remainder = normalizedValue.slice(normalizedRoot.length);
  return normalizedValue.toLowerCase().startsWith(normalizedRoot.toLowerCase())
    && (remainder === '' || remainder.startsWith('/'))
    ? `${marker}${normalizedValue.slice(normalizedRoot.length)}`
    : value;
}

interface StreamState {
  deadlineAt: number;
  events: RuntimeEvent[];
  eventsTruncated: boolean;
  approvals: RuntimeEvent[];
  modelCalls: number;
  toolCalls: number;
  limits: ExecutionProfile['limits'];
}

async function consumeRuntimeStream(stream: AsyncIterable<RuntimeEvent>, state: StreamState): Promise<RuntimeEvent | undefined> {
  const iterator = stream[Symbol.asyncIterator]();
  while (true) {
    const next = await nextBeforeDeadline(iterator, state.deadlineAt);
    if (next.done) return undefined;
    const event = next.value;
    if (state.events.length < 10_000) state.events.push(event);
    else state.eventsTruncated = true;
    if (event.eventType === 'approval.requested') state.approvals.push(event);
    if (event.eventType === 'model_call.started') state.modelCalls += 1;
    if (event.eventType === 'tool_call.requested') state.toolCalls += 1;
    if (state.limits.maxModelCalls && state.modelCalls > state.limits.maxModelCalls) {
      await iterator.return?.();
      throw new EvaluationLimitError('model_call_limit_reached', 'Evaluation Model Call limit was reached.');
    }
    if (state.limits.maxToolCalls && state.toolCalls > state.limits.maxToolCalls) {
      await iterator.return?.();
      throw new EvaluationLimitError('tool_call_limit_reached', 'Evaluation Tool Call limit was reached.');
    }
    if (isTerminalEvent(event)) {
      await iterator.return?.();
      return event;
    }
  }
}

async function nextBeforeDeadline(
  iterator: AsyncIterator<RuntimeEvent>,
  deadlineAt: number,
): Promise<IteratorResult<RuntimeEvent>> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new EvaluationLimitError('wall_clock_limit_reached', 'Evaluation wall-clock deadline was reached.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new EvaluationLimitError('wall_clock_limit_reached', 'Evaluation wall-clock deadline was reached.')),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cancelAndConsume(host: EvaluationHost, runId: string, state: StreamState): Promise<void> {
  const cancelled = await host.chat.cancelUserInput({ runId });
  if (cancelled.events) await consumeRuntimeStream(cancelled.events, state).catch(() => undefined);
}

function createApprovalScriptMatcher(evaluationCase: EvaluationCase) {
  const script = evaluationCase.approvalScript ?? [];
  const seen = script.map(() => 0);
  const used = new Set<number>();
  return {
    resolve(event: RuntimeEvent): { status: 'matched'; payload: Parameters<EvaluationHost['approval']['resolve']>[0] } | { status: 'unmatched'; message: string } {
      const approval = approvalFacts(event);
      if (!approval) return { status: 'unmatched', message: 'Approval event did not contain stable request facts.' };
      const candidates: number[] = [];
      script.forEach((entry, index) => {
        if (used.has(index) || !matchesApproval(entry.matcher, approval)) return;
        seen[index] += 1;
        if (seen[index] === entry.matcher.occurrence) candidates.push(index);
      });
      if (candidates.length !== 1) {
        return { status: 'unmatched', message: `Approval request did not uniquely match the script: ${approval.toolName}` };
      }
      const index = candidates[0]!;
      used.add(index);
      const decision = script[index]!;
      if (decision.decision === 'deny') {
        return {
          status: 'matched',
          payload: {
            approvalRequestId: approval.approvalRequestId,
            decision: 'denied',
            reason: 'Evaluation approval script denied this request.',
          },
        };
      }
      const scope = decision.decision === 'allow_session' ? 'session' : 'once';
      const option = approval.options.find((item) => item.scope === scope);
      if (!option) return { status: 'unmatched', message: `Approval request has no ${scope} option: ${approval.toolName}` };
      return {
        status: 'matched',
        payload: { approvalRequestId: approval.approvalRequestId, decision: 'approved', optionId: option.optionId },
      };
    },
  };
}

interface ApprovalFacts {
  approvalRequestId: string;
  toolName: string;
  toolIdentity?: { sourceId: string; namespace: string; sourceToolName: string };
  actions: string[];
  resources: string[];
  options: Array<{ optionId: string; scope: string }>;
}

function approvalFacts(event: RuntimeEvent): ApprovalFacts | undefined {
  const request = (event.payload as { approvalRequest?: Record<string, unknown> }).approvalRequest;
  const preview = request?.preview as { action?: unknown; targets?: Array<{ label?: unknown }> } | undefined;
  const rawOptions = request?.options as Array<{ option_id?: unknown; scope?: unknown }> | undefined;
  const rawIdentity = request?.toolIdentity as { sourceId?: unknown; namespace?: unknown; sourceToolName?: unknown } | undefined;
  const operations = Array.isArray(request?.operations) ? request.operations as Array<{
    action?: unknown;
    resource?: { matcher?: { value?: unknown }; type?: unknown };
  }> : [];
  const approvalRequestId = request?.approvalRequestId;
  const toolName = request?.toolName;
  if (typeof approvalRequestId !== 'string' || typeof toolName !== 'string' || !Array.isArray(rawOptions)) return undefined;
  return {
    approvalRequestId,
    toolName,
    ...(rawIdentity && typeof rawIdentity.sourceId === 'string' && typeof rawIdentity.namespace === 'string'
      && typeof rawIdentity.sourceToolName === 'string'
      ? { toolIdentity: { sourceId: rawIdentity.sourceId, namespace: rawIdentity.namespace, sourceToolName: rawIdentity.sourceToolName } }
      : {}),
    actions: [
      ...operations.flatMap((operation) => typeof operation.action === 'string' ? [operation.action] : []),
      ...(typeof preview?.action === 'string' ? [preview.action] : []),
    ],
    resources: [
      ...(preview?.targets ?? []).flatMap((target) => typeof target.label === 'string' ? [target.label] : []),
      ...operations.flatMap((operation) => typeof operation.resource?.matcher?.value === 'string'
        ? [operation.resource.matcher.value]
        : []),
    ],
    options: rawOptions.flatMap((option) => typeof option.option_id === 'string' && typeof option.scope === 'string'
      ? [{ optionId: option.option_id, scope: option.scope }]
      : []),
  };
}

function matchesApproval(
  matcher: NonNullable<EvaluationCase['approvalScript']>[number]['matcher'],
  approval: ApprovalFacts,
): boolean {
  return matcher.toolName === approval.toolName
    && (!matcher.toolIdentity || Boolean(approval.toolIdentity
      && matcher.toolIdentity.sourceId === approval.toolIdentity.sourceId
      && matcher.toolIdentity.namespace === approval.toolIdentity.namespace
      && matcher.toolIdentity.sourceToolName === approval.toolIdentity.sourceToolName))
    && (!matcher.action || approval.actions.includes(matcher.action))
    && (!matcher.resource || approval.resources.includes(matcher.resource));
}

function isTerminalEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'run.completed' || event.eventType === 'run.failed' || event.eventType === 'run.cancelled';
}

class SetupError extends Error {}
class RunnerError extends Error {}
class EvaluationLimitError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function graderWorkspacePaths(evaluationCase: EvaluationCase): string[] {
  return [...new Set(evaluationCase.graders.flatMap((grader) => {
    if (!['file_exists', 'file_absent', 'file_content', 'file_unchanged'].includes(grader.type)) return [];
    const candidate = grader.config?.path;
    return typeof candidate === 'string' ? [candidate.replace(/\\/g, '/')] : [];
  }))];
}

async function snapshotWorkspaceFiles(
  workspaceRoot: string,
  relativePaths: string[],
): Promise<Record<string, { exists: boolean; content?: string; digest?: string }>> {
  const snapshot: Record<string, { exists: boolean; content?: string; digest?: string }> = {};
  for (const relativePath of relativePaths) {
    if (path.isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('../')) continue;
    try {
      const [read, digest] = await Promise.all([
        readBoundedOwnedText(workspaceRoot, relativePath, 64 * 1024),
        digestOwnedFile(workspaceRoot, relativePath),
      ]);
      snapshot[relativePath] = { exists: true, content: read.content, digest };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') snapshot[relativePath] = { exists: false };
    }
  }
  return snapshot;
}

function unavailableEvidence(executionId: string): EvaluationEvidence {
  return {
    session: { sessionId: `unavailable:${executionId}`, messages: [], timeline: [], complete: false },
    workspace: { files: [], complete: false },
    runtimeEvents: { events: [], complete: false, truncated: false },
    diagnostics: { available: false, error: 'Execution did not reach evidence collection.' },
  };
}

async function prepareEvaluationAttachments(
  evaluationCase: EvaluationCase,
  workspaceRoot: string,
): Promise<Array<{
  draftAttachmentId: string;
  type: 'image';
  name: string;
  declaredMimeType: string;
  source: { type: 'host_file_reference'; referenceId: string };
}>> {
  const output = [];
  for (const [index, attachment] of (evaluationCase.request.attachments ?? []).entries()) {
    let referenceId: string;
    try {
      referenceId = await resolveOwnedWorkspacePath(workspaceRoot, path.join(workspaceRoot, attachment.path));
      const details = await stat(referenceId);
      if (!details.isFile()) throw new Error('Attachment is not a file.');
    } catch (error) {
      throw new SetupError(`Evaluation attachment could not be prepared (${attachment.path}): ${errorMessage(error)}`);
    }
    const declaredMimeType = attachment.mimeType ?? imageMimeType(attachment.path);
    if (!declaredMimeType || !['image/png', 'image/jpeg', 'image/webp'].includes(declaredMimeType)) {
      throw new SetupError(`Evaluation image attachment has an unsupported media type: ${attachment.path}`);
    }
    output.push({
      draftAttachmentId: `evaluation-attachment-${index + 1}`,
      type: 'image' as const,
      name: path.basename(attachment.path),
      declaredMimeType,
      source: { type: 'host_file_reference' as const, referenceId },
    });
  }
  return output;
}

function imageMimeType(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return undefined;
}
