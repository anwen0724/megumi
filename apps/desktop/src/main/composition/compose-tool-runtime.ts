// Composes tool registry access, tool execution runtime factory, and tool IPC service.
import fs from 'fs-extra';
import { createBuiltInToolRegistry } from '@megumi/coding-agent/tools/built-ins';
import type { ToolRegistry } from '@megumi/coding-agent/tools/registry';
import { SessionRunRepository } from '@megumi/desktop/main/persistence/repos/session-run.repo';
import { ToolRepository } from '@megumi/desktop/main/persistence/repos/tool.repo';
import { WorkspaceChangeRepository } from '@megumi/desktop/main/persistence/repos/workspace-change.repo';
import { ToolService } from '../services/tool/tool.service';
import { createBuiltInToolSourceExecutor } from '../services/tool/built-in-tool-source-executor.service';
import { createExternalTestToolSourceExecutor } from '../services/tool/external-test-tool-source-executor.service';
import { createToolOrchestratorService } from '@megumi/coding-agent/tools/tool-orchestrator';
import { createToolExecutionRouter } from '../services/tool/tool-execution-router.service';
import { WorkspaceChangeTrackerService } from '@megumi/coding-agent/workspace';
import type { PermissionSettingsService } from '../services/security/permission-settings.service';
import type { SessionRunService, SessionRunToolRuntimeFactory } from '../services/session/session-run.service';

export function composeToolRegistry(): ToolRegistry {
  return createBuiltInToolRegistry();
}

export function composeToolRuntimeFactory(input: {
  toolRepository: ToolRepository;
  toolRegistry: ToolRegistry;
  workspaceChangeRepository: WorkspaceChangeRepository;
  sessionRunRepository: SessionRunRepository;
  permissionSettingsService: PermissionSettingsService;
}): SessionRunToolRuntimeFactory {
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
      return createToolOrchestratorService({
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
          getRunSessionId(runId) {
            const run = input.sessionRunRepository.getRun(runId);
            return run ? String(run.sessionId) : undefined;
          },
        },
        permissionMode,
        projectRoot,
        settings: await input.permissionSettingsService.loadForProject(projectRoot),
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

export function composeToolService(input: {
  toolRepository: ToolRepository;
  toolRegistry: ToolRegistry;
  sessionRunService: SessionRunService;
}) {
  return new ToolService({
    repository: input.toolRepository,
    registry: input.toolRegistry,
    resumeApproval: (request) => input.sessionRunService.resumeApproval(request),
  });
}
