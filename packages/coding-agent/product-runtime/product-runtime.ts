// Defines the complete Coding Agent product runtime exposed to UI shells and non-desktop entries.
// Every member is a product-owned port interface — this is the single shell-agnostic
// contract that desktop, and future web/cli shells, code against.
import type { AgentLoopOperationPort } from './agent-loop-operation-port';
import type { RecoveryService } from '../state';
import type { SessionBranchServicePort, SessionServicePort } from '../session';
import type { ToolService } from '../tools/tool-service-port';
import type { ArtifactServicePort, PlanArtifactServicePort } from '../artifacts';
import type { MemoryService } from '../memory';
import type { RunContextServicePort } from '../context/resources';
import type { ProductSettingsPort, ProviderSettingsPort } from '../settings';
import type { ProjectService } from '../workspace';
import type { PermissionMode } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type { Session } from '@megumi/shared/session';
import type {
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc';

export interface ProductRuntimeSubmitInput {
  requestId?: string;
  sessionId?: string;
  sessionTitle?: string;
  workspaceId?: string;
  workspacePath?: string;
  providerId: ProviderId;
  modelId: string;
  text: string;
  createdAt?: string;
  permissionMode?: PermissionMode;
  runtimeContext?: RuntimeContext;
}

export interface ProductRuntimeSubmitInputResult {
  session: Session;
  requestId: string;
  userMessageId: string;
  runId: string;
  events: AsyncIterable<RuntimeEvent>;
}

export interface CodingAgentProductRuntime {
  submitInput(input: ProductRuntimeSubmitInput): Promise<ProductRuntimeSubmitInputResult>;
  sendSessionMessage(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }>;
  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean;
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
  sessionService: SessionServicePort;
  sessionBranchService: SessionBranchServicePort;
  recoveryService: RecoveryService;
  toolService: ToolService;
  artifactService: ArtifactServicePort;
  planArtifactService: PlanArtifactServicePort;
  memoryService: MemoryService;
  runContextService: RunContextServicePort;
  settingsService: ProductSettingsPort;
  providerSettingsService: ProviderSettingsPort;
  projectService: ProjectService;
  dispose(): void;
}

export interface CodingAgentProductRuntimeServices {
  sessionService: SessionServicePort;
  sessionBranchService: SessionBranchServicePort;
  agentLoopOperation: AgentLoopOperationPort;
  recoveryService: RecoveryService;
  toolService: ToolService;
  artifactService: ArtifactServicePort;
  planArtifactService: PlanArtifactServicePort;
  memoryService: MemoryService;
  runContextService: RunContextServicePort;
  settingsService: ProductSettingsPort;
  providerSettingsService: ProviderSettingsPort;
  projectService: ProjectService;
  dispose(): void;
}

export function createCodingAgentProductRuntime(
  services: CodingAgentProductRuntimeServices,
): CodingAgentProductRuntime {
  return {
    submitInput: (input) => submitInput(services, input),
    sendSessionMessage: (input) => services.agentLoopOperation.sendSessionMessage(input),
    cancelSessionMessage: (payload) => services.agentLoopOperation.cancelSessionMessage(payload),
    listRuntimeEventsByRun: (runId) => services.agentLoopOperation.listRuntimeEventsByRun(runId),
    sessionService: services.sessionService,
    sessionBranchService: services.sessionBranchService,
    recoveryService: services.recoveryService,
    toolService: services.toolService,
    artifactService: services.artifactService,
    planArtifactService: services.planArtifactService,
    memoryService: services.memoryService,
    runContextService: services.runContextService,
    settingsService: services.settingsService,
    providerSettingsService: services.providerSettingsService,
    projectService: services.projectService,
    dispose: services.dispose,
  };
}

async function submitInput(
  runtime: CodingAgentProductRuntimeServices,
  input: ProductRuntimeSubmitInput,
): Promise<ProductRuntimeSubmitInputResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const requestId = input.requestId ?? `product-submit:${crypto.randomUUID()}`;
  const session = resolveOrCreateSession(runtime.sessionService, input, createdAt);
  const userMessageLocalId = `message-local:${crypto.randomUUID()}`;
  const context = input.permissionMode
    ? { permissionMode: input.permissionMode }
    : undefined;
  const run = await runtime.agentLoopOperation.sendSessionMessage({
    requestId,
    payload: {
      sessionId: String(session.sessionId),
      providerId: input.providerId,
      modelId: input.modelId,
      ...(context ? { context } : {}),
      messages: [{
        id: userMessageLocalId,
        role: 'user',
        content: input.text,
        createdAt,
      }],
      createdAt,
    },
    ...(input.runtimeContext ? { runtimeContext: input.runtimeContext } : {}),
  });
  const persistedUserMessage = runtime.sessionService.listMessagesBySession(String(session.sessionId))
    .filter((message) => message.role === 'user' && message.content === input.text && message.createdAt === createdAt)
    .at(-1);

  if (!persistedUserMessage?.runId) {
    throw new Error('Product submit input did not persist a user message run.');
  }

  return {
    session,
    requestId: run.data.requestId,
    userMessageId: String(persistedUserMessage.messageId),
    runId: String(persistedUserMessage.runId),
    events: run.events,
  };
}

function resolveOrCreateSession(
  sessionService: SessionServicePort,
  input: ProductRuntimeSubmitInput,
  createdAt: string,
): Session {
  if (input.sessionId) {
    const session = sessionService.listSessions()
      .find((candidate) => String(candidate.sessionId) === input.sessionId);
    if (!session) {
      throw new Error(`Cannot submit input to missing session: ${input.sessionId}`);
    }
    return session;
  }

  return sessionService.createSession({
    title: input.sessionTitle ?? titleFromInput(input.text),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    createdAt,
  });
}

function titleFromInput(text: string): string {
  const title = text.trim().replace(/\s+/g, ' ').slice(0, 80);
  return title.length > 0 ? title : 'New session';
}
