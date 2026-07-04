// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

function walkSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return walkSourceFiles(fullPath);
    }

    return sourceExtensions.has(extname(entry.name)) ? [fullPath] : [];
  });
}

function relativePath(filePath: string): string {
  return relative(root, filePath).replaceAll(sep, '/');
}

function sourceUnder(relativeDirectory: string): string {
  return walkSourceFiles(join(root, relativeDirectory))
    .map((file) => `\n// ${relativePath(file)}\n${readFileSync(file, 'utf8')}`)
    .join('\n');
}

describe('coding-agent package boundary', () => {
  it('exists as the Megumi Coding Agent product-core package', () => {
    expect(existsSync(join(root, 'packages/coding-agent/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/contracts/context-contracts.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/services/context-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/services/context-usage-monitor.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/services/context-compaction-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/core/prompt-builder.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/model-input/model-call-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/model-input/model-call-input-builder.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/contracts/session-contracts.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/services/session-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/repositories/session-repository.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/core/session-path.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context-input.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/model-input/parts/session-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/core/run-input-facts.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/obsolete-run/index.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/services/agent-run-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/agent-loop-operation.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/agent-loop-operation-port.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/context/run-input-facts.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/obsolete-run/turn/run-turn.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/hooks/services/post-run-hooks.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/obsolete-run/completion/run-completion-hooks.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/state/run-terminal-coordinator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/obsolete-run/lifecycle/run-terminal-coordinator.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/model-call/model-call-stream.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/obsolete-run/model-call/model-call-stream.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/events/runtime-event-utils.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/host-interface/host-interface.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/connection.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/services/tool-execution-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/host-interface/runtime-logger.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/obsolete-run/tool-calls/tool-call-runner.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/tools/tool-orchestrator.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/tools/services/tool-registry-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/core/tool-registry.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/adapters/built-in-tools.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/permissions/services/permission-service.ts'))).toBe(true);
    expect(existsSync(join(root, ['packages/coding-agent/permissions', 'core/permission-policy.ts'].join('/')))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/obsolete-run/permissions/project-boundary-policy.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-recall-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-runtime-capture.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-management-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/artifacts/artifact-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/artifacts/plan-artifact-compatibility.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/workspace/services/workspace-change-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/workspace/workspace-restore.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/settings/services/settings-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/adapters/local/context/agent-instruction-source.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/run-context/run-context-service.ts'))).toBe(true);
  });

  it('keeps user input orchestration in coding-agent input service instead of desktop session service', () => {
    const inputService = sourceUnder('packages/coding-agent/input');
    const codingAgentLoop = sourceUnder('packages/coding-agent/agent-loop');
    const codingAgentState = sourceUnder('packages/coding-agent/state');
    const codingAgentContext = sourceUnder('packages/coding-agent/context');
    const codingAgentInput = sourceUnder('packages/coding-agent/input');
    const desktopServices = sourceUnder('apps/desktop/src/main/services');

    expect(inputService).toContain('processUserInput');
    expect(inputService).not.toContain('CommandService');
    expect(codingAgentLoop).toContain('class AgentRunProcessingService');
    expect(codingAgentLoop).toContain('handleAgentRunInput');
    expect(codingAgentLoop).toContain('submitUserInputToAgentLoop');
    expect(codingAgentState).toContain('class RunTerminalCoordinator');
    expect(codingAgentLoop).toContain('class AgentLoop');
    expect(codingAgentLoop).toContain('runModelToolLoop');
    expect(codingAgentLoop).toContain('buildModelCallInput');
    expect(codingAgentContext).toContain('class ContextService');
    expect(codingAgentContext).toContain('class ContextUsageMonitor');
    expect(codingAgentContext).toContain('class ContextCompactionService');
    expect(codingAgentLoop).toContain('class ModelCallInputBuildService');
    expect(codingAgentInput).not.toContain('createCodingAgentRunInputFacts');
    expect(codingAgentLoop).toContain('createCodingAgentRunInputFacts');
    expect(existsSync(join(root, 'apps/desktop/src/main/services/session/session-run.service.ts'))).toBe(false);
    expect(desktopServices).not.toContain('new RunTurn');
    expect(desktopServices).not.toContain("contextKind: 'compaction-probe'");
    expect(desktopServices).not.toContain("contextKind: 'initial'");
  });

  it('keeps product core free of desktop and Electron UI shell dependencies', () => {
    const source = sourceUnder('packages/coding-agent');

    expect(source).not.toContain('@megumi/desktop');
    expect(source).not.toContain('apps/desktop');
    expect(source).not.toContain("from 'electron'");
    expect(source).not.toContain('BrowserWindow');
    expect(source).not.toContain('ipcMain');
    expect(source).not.toContain('preload');
    expect(source).not.toContain('renderer');
    expect(source).not.toContain('@megumi/db');
    expect(source).not.toContain('@megumi/core');
  });

  it('keeps memory, artifacts, workspace, settings, instructions, and resources in coding-agent', () => {
    const memory = sourceUnder('packages/coding-agent/memory');
    const artifacts = sourceUnder('packages/coding-agent/artifacts');
    const workspace = sourceUnder('packages/coding-agent/workspace');
    const settings = sourceUnder('packages/coding-agent/settings');
    const hostInterface = sourceUnder('packages/coding-agent/host-interface');
    const inputService = sourceUnder('packages/coding-agent/input');
    const instructions = sourceUnder('packages/coding-agent/adapters/local/context');
    const resources = sourceUnder('packages/coding-agent/agent-loop/run-context');
    const desktopServices = sourceUnder('apps/desktop/src/main/services');

    expect(memory).toContain('class MemoryRecallRuntimeService');
    expect(memory).toContain('class MemoryRuntimeCaptureService');
    expect(memory).toContain('createMemoryService');
    expect(artifacts).toContain('class ArtifactService');
    expect(artifacts).toContain('class PlanArtifactCompatibilityService');
    expect(workspace).toContain('createWorkspaceService');
    expect(workspace).toContain('createWorkspacePathPolicyService');
    expect(workspace).toContain('createWorkspaceChangeService');
    expect(settings).toContain('function createSettingsService');
    expect(settings).toContain('resolveProviderRuntimeConfig');
    expect(hostInterface).toContain('input: InputController');
    expect(inputService).toContain('createInputService');
    expect(instructions).toContain('class AgentInstructionSourceService');
    expect(resources).toContain('class RunContextService');

    expect(desktopServices).not.toContain('class MemoryRecallRuntimeService');
    expect(desktopServices).not.toContain('class MemoryRuntimeCaptureService');
    expect(desktopServices).not.toContain('class ArtifactService');
    expect(desktopServices).not.toContain('class WorkspaceRestoreService');
  });

  it('keeps session facts separate from model context materialization', () => {
    const session = sourceUnder('packages/coding-agent/session');
    const runContextParts = sourceUnder('packages/coding-agent/agent-loop/model-input/parts');

    expect(session).not.toContain('ModelInputContextPartDraft');
    expect(session).not.toContain('context-budget');
    expect(session).not.toContain('buildSessionContextParts');
    expect(runContextParts).toContain('buildSessionContextParts');
  });

  it('does not keep a top-level packages/agent package', () => {
    expect(existsSync(join(root, 'packages/agent'))).toBe(false);
  });

  it('keeps tool orchestration and permission policy in coding-agent instead of desktop services', () => {
    const tools = sourceUnder('packages/coding-agent/tools');
    const toolCalls = sourceUnder('packages/coding-agent/agent-loop/tool-call');
    const permissions = sourceUnder('packages/coding-agent/permissions');
    const desktopToolServices = sourceUnder('apps/desktop/src/main/services/tool');

    expect(toolCalls).toContain('createToolCallRunner');
    expect(tools).not.toContain('createToolCallRunner');
    expect(tools).toContain('class ToolRegistryService');
    expect(tools).toContain('class ToolExecutionService');
    expect(tools).toContain('registeredToolName');
    const toolsIndex = readFileSync(join(root, 'packages/coding-agent/tools/index.ts'), 'utf8');
    expect(toolsIndex).not.toContain('ToolRegistrySnapshotService');
    expect(toolsIndex).not.toContain('createToolExecutionRouter');
    expect(toolsIndex).not.toContain('ToolService');
    expect(permissions).toContain('evaluateToolExecution');
    expect(permissions).toContain('validateApprovalDecision');
    expect(permissions).toContain('applyApprovalDecision');
    expect(desktopToolServices).not.toContain('function applyDecision');
    expect(desktopToolServices).not.toContain('function prepareRecords');
    expect(desktopToolServices).not.toContain('class ToolRegistrySnapshotService');
    expect(desktopToolServices).not.toContain('function evaluateToolExecution');
  });

  it('does not keep the context-management compatibility package after final cleanup', () => {
    expect(existsSync(join(root, 'packages/context-management'))).toBe(false);
  });
});
