// Composes Coding Agent tool services and wires them into the agent loop.
import fs from 'fs-extra';
import { createToolCallRunner } from '../agent-loop/tool-call';
import type { AgentLoopRepository } from '../persistence/repos/agent-loop.repo';
import type { ToolCallRepository } from '../persistence/repos/tool-call.repo';
import type { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import type { PermissionSettingsProvider } from '../permissions/permission-settings-provider';
import {
  ToolExecutionService,
  ToolRegistryService,
} from '../tools';
import { createBuiltInToolAdapter } from '../tools/adapters/built-in-tools';

export function composeCodingAgentToolRegistryService(): ToolRegistryService {
  return new ToolRegistryService();
}

export function composeCodingAgentToolExecutionService(input: {
  projectRoot: string;
  fileSystem?: typeof fs;
  registryService?: ToolRegistryService;
}): ToolExecutionService {
  const registryService = input.registryService ?? composeCodingAgentToolRegistryService();
  return new ToolExecutionService({
    registryService,
    builtInTools: createBuiltInToolAdapter({
      projectRoot: input.projectRoot,
      fileSystem: input.fileSystem ?? fs,
    }),
  });
}

export function composeCodingAgentToolRuntimeFactory(input: {
  toolRepository: ToolCallRepository;
  toolRegistry: ToolRegistryService;
  workspaceChangeRepository: WorkspaceChangeRepository;
  runRepository: AgentLoopRepository;
  permissionSettingsProvider: PermissionSettingsProvider;
}): ToolRuntimeFactory {
  void input.workspaceChangeRepository;
  return {
    async create({ projectRoot, permissionMode }) {
      return createToolCallRunner({
        repository: {
          startToolCall: (toolCall) => input.toolRepository.startToolCall(toolCall),
          getToolCall: (toolCallId) => input.toolRepository.getToolCall(toolCallId),
          recordToolExecution: (toolExecution) => input.toolRepository.recordToolExecution(toolExecution),
          getToolExecution: (toolExecutionId) => input.toolRepository.getToolExecution(toolExecutionId),
          getToolExecutionByToolCallId: (request) => input.toolRepository.getToolExecutionByToolCallId(request),
          listToolExecutionsByAssistantMessage: (request) => input.toolRepository.listToolExecutionsByAssistantMessage(request),
          recordPermissionDecision: (permissionDecision) => input.toolRepository.recordPermissionDecision(permissionDecision),
          createApprovalRequest: (approvalRequest) => input.toolRepository.createApprovalRequest(approvalRequest),
          getApprovalRequest: (approvalRequestId) => input.toolRepository.getApprovalRequest(approvalRequestId),
          completeToolCall: (toolResult) => input.toolRepository.completeToolCall(toolResult),
          markToolResultsSubmittedToModelInput: (request) =>
            input.toolRepository.markToolResultsSubmittedToModelInput(request),
          getRunSessionId(runId) {
            const run = input.runRepository.getRun(runId);
            return run ? String(run.sessionId) : undefined;
          },
        },
        toolRegistryService: input.toolRegistry,
        toolExecutionService: composeCodingAgentToolExecutionService({
          projectRoot,
          registryService: input.toolRegistry,
        }),
        permissionMode,
        projectRoot,
        settings: await input.permissionSettingsProvider.loadForProject(projectRoot),
        ids: {
          toolExecutionId: () => `tool-execution:${crypto.randomUUID()}`,
          toolResultId: () => `tool-result:${crypto.randomUUID()}`,
          permissionDecisionId: () => `permission-decision:${crypto.randomUUID()}`,
          approvalRequestId: () => `approval-request:${crypto.randomUUID()}`,
          rawToolResultId: () => `raw-tool-result:${crypto.randomUUID()}`,
          observationId: () => `tool-observation:${crypto.randomUUID()}`,
          eventId: () => `event:${crypto.randomUUID()}`,
        },
      });
    },
  };
}
