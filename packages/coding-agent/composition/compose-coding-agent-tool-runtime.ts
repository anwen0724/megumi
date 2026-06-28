// Composes Coding Agent tool registry, local tool adapters, and tool orchestration.
import fs from 'fs-extra';
import { createBuiltInToolRegistry } from '../tools/built-ins';
import type { ToolRegistry } from '../tools/registry';
import { createToolCallRunner } from '../agent-loop/tool-call';
import { ToolService } from '../tools/tool-service';
import { WorkspaceChangeTrackerService } from '../workspace';
import type { RunRecordRepository } from '../persistence/repos/run-record.repo';
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { WorkspaceChangeRepository } from '../persistence/repos/workspace-change.repo';
import type { AgentRunToolRuntimeFactory } from '../run/run-contract';
import { createBuiltInToolSourceExecutor } from '../tools/execution/built-in-tool-source-executor';
import { createExternalTestToolSourceExecutor } from '../tools/execution/external-test-tool-source-executor';
import { createToolExecutionRouter } from '../tools/execution/tool-execution-router';
import type { PermissionSettingsProvider } from '../permissions/permission-settings-provider';

export function composeCodingAgentToolRegistry(): ToolRegistry {
  return createBuiltInToolRegistry();
}

export function composeCodingAgentToolRuntimeFactory(input: {
  toolRepository: ToolRepository;
  toolRegistry: ToolRegistry;
  workspaceChangeRepository: WorkspaceChangeRepository;
  runRepository: RunRecordRepository;
  permissionSettingsProvider: PermissionSettingsProvider;
}): AgentRunToolRuntimeFactory {
  return {
    async create({ projectRoot, permissionMode }) {
      const workspaceChangeTracker = new WorkspaceChangeTrackerService({
        projectRoot,
        fileSystem: fs,
        repository: input.workspaceChangeRepository,
        ids: {
          changeSetId: () => `workspace-change-set:${crypto.randomUUID()}`,
          workspaceCheckpointId: () => `workspace-checkpoint:${crypto.randomUUID()}`,
          snapshotContentRefId: () => `workspace-snapshot:${crypto.randomUUID()}`,
          changedFileId: () => `workspace-changed-file:${crypto.randomUUID()}`,
        },
      });

      return createToolCallRunner({
        registry: input.toolRegistry,
        repository: {
          saveToolCall: (toolCall) => input.toolRepository.saveToolCall(toolCall),
          getToolCall: (toolCallId) => input.toolRepository.getToolCall(toolCallId),
          saveToolExecution: (toolExecution) => input.toolRepository.saveToolExecution(toolExecution),
          getToolExecution: (toolExecutionId) => input.toolRepository.getToolExecution(toolExecutionId),
          getToolExecutionByToolCallId: (request) => input.toolRepository.getToolExecutionByToolCallId(request),
          listToolExecutionsByAssistantMessage: (request) => input.toolRepository.listToolExecutionsByAssistantMessage(request),
          savePermissionDecision: (permissionDecision) => input.toolRepository.savePermissionDecision(permissionDecision),
          saveApprovalRequest: (approvalRequest) => input.toolRepository.saveApprovalRequest(approvalRequest),
          getApprovalRequest: (approvalRequestId) => input.toolRepository.getApprovalRequest(approvalRequestId),
          saveToolResult: (toolResult) => input.toolRepository.saveToolResult(toolResult),
          getToolRegistrySnapshotByRun: (runId) => input.toolRepository.getToolRegistrySnapshotByRun(runId),
          markToolResultsSubmittedToModelInput: (request) =>
            input.toolRepository.markToolResultsSubmittedToModelInput(request),
          getRunSessionId(runId) {
            const run = input.runRepository.getRun(runId);
            return run ? String(run.sessionId) : undefined;
          },
        },
        permissionMode,
        projectRoot,
        settings: await input.permissionSettingsProvider.loadForProject(projectRoot),
        toolExecutionRouter: createToolExecutionRouter({
          sourceExecutors: [
            createBuiltInToolSourceExecutor({
              projectRoot,
              workspaceChangeTracker,
              ids: {
                toolResultId: () => `tool-result:${crypto.randomUUID()}`,
                rawToolResultId: () => `raw-tool-result:${crypto.randomUUID()}`,
              },
            }),
            createExternalTestToolSourceExecutor(),
          ],
        }),
      });
    },
  };
}

export function composeCodingAgentToolService(input: {
  toolRegistry: ToolRegistry;
  toolRepository: ToolRepository;
  resumeApproval: ToolService['resumeApproval'];
}): ToolService {
  return new ToolService({
    registry: input.toolRegistry,
    repository: input.toolRepository,
    resumeApproval: input.resumeApproval,
  });
}
