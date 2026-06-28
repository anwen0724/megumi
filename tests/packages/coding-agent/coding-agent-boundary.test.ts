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
    expect(existsSync(join(root, 'packages/coding-agent/context/model-call-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/model-call-input-builder.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/compaction/session-compaction-orchestrator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context-input.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/context/parts/session-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/input/facts/input-facts.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/run-input-facts.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/run/turn/run-turn.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/hooks/post-run-hooks.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/completion/run-completion-hooks.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/state/run-terminal-coordinator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/lifecycle/run-terminal-coordinator.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/model-call/model-call-stream.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/model-call/model-call-stream.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/events/runtime-event-utils.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/product-runtime/product-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/connection.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/execution/tool-execution-router.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/product-runtime/runtime-logger.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/tool-calls/tool-call-runner.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/tools/tool-orchestrator.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/tools/tool-registry-snapshot.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/registry/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/built-ins/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/permissions/tool-policy.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/permissions/tool-execution-decision.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/permissions/project-boundary-policy.ts'))).toBe(false);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-recall-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-runtime-capture.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-management-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/artifacts/artifact-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/artifacts/plan-artifact-compatibility.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/workspace/workspace-change-tracker.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/workspace/workspace-restore.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/settings/provider-settings.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/settings/provider-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/instructions/agent-instruction-source.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/resources/run-context-service.ts'))).toBe(true);
  });

  it('keeps run orchestration in coding-agent instead of desktop session service', () => {
    const codingAgentRun = sourceUnder('packages/coding-agent/run');
    const codingAgentLoop = sourceUnder('packages/coding-agent/agent-loop');
    const codingAgentState = sourceUnder('packages/coding-agent/state');
    const codingAgentContext = sourceUnder('packages/coding-agent/context');
    const codingAgentInput = sourceUnder('packages/coding-agent/input');
    const desktopServices = sourceUnder('apps/desktop/src/main/services');

    expect(codingAgentRun).not.toContain('class RunTurn');
    expect(codingAgentRun).not.toContain('class RunCompletionHooksCoordinator');
    expect(codingAgentState).toContain('class RunTerminalCoordinator');
    expect(codingAgentLoop).toContain('class AgentLoop');
    expect(codingAgentLoop).toContain('runModelToolLoop');
    expect(codingAgentLoop).toContain('buildModelCallInput');
    expect(codingAgentContext).toContain('class ModelCallInputBuildService');
    expect(codingAgentInput).toContain('createCodingAgentRunInputFacts');
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
    const productRuntime = sourceUnder('packages/coding-agent/product-runtime');
    const instructions = sourceUnder('packages/coding-agent/context/instructions');
    const resources = sourceUnder('packages/coding-agent/context/resources');
    const desktopServices = sourceUnder('apps/desktop/src/main/services');

    expect(memory).toContain('class MemoryRecallRuntimeService');
    expect(memory).toContain('class MemoryRuntimeCaptureService');
    expect(memory).toContain('createMemoryService');
    expect(artifacts).toContain('class ArtifactService');
    expect(artifacts).toContain('class PlanArtifactCompatibilityService');
    expect(workspace).toContain('class WorkspaceChangeTrackerService');
    expect(workspace).toContain('class WorkspaceRestoreService');
    expect(settings).toContain('class ProviderSettingsService');
    expect(settings).toContain('class ProviderRuntimeService');
    expect(productRuntime).toContain('submitInput');
    expect(instructions).toContain('class AgentInstructionSourceService');
    expect(resources).toContain('class RunContextService');

    expect(desktopServices).not.toContain('class MemoryRecallRuntimeService');
    expect(desktopServices).not.toContain('class MemoryRuntimeCaptureService');
    expect(desktopServices).not.toContain('class ArtifactService');
    expect(desktopServices).not.toContain('class WorkspaceChangeTrackerService');
    expect(desktopServices).not.toContain('class WorkspaceRestoreService');
  });

  it('keeps session facts separate from model context materialization', () => {
    const session = sourceUnder('packages/coding-agent/session');
    const runContextParts = sourceUnder('packages/coding-agent/context/parts');

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
    expect(tools).toContain('class ToolRegistrySnapshotService');
    expect(tools).toContain('createToolRegistrySnapshot');
    expect(permissions).toContain('evaluatePermissionPolicy');
    expect(permissions).toContain('evaluateToolExecutionDecision');
    expect(desktopToolServices).not.toContain('function applyDecision');
    expect(desktopToolServices).not.toContain('function prepareRecords');
    expect(desktopToolServices).not.toContain('class ToolRegistrySnapshotService');
    expect(desktopToolServices).not.toContain('function evaluateToolExecutionDecision');
  });

  it('does not keep the context-management compatibility package after final cleanup', () => {
    expect(existsSync(join(root, 'packages/context-management'))).toBe(false);
  });
});
