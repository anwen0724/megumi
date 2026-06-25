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
    expect(existsSync(join(root, 'packages/coding-agent/context/model-step-input-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/model-step-input-build.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/context/session-compaction-orchestrator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context-input.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/session/session-context.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/input-facts.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/run-orchestrator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/model-step-stream.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/run/event-utils.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/product-runtime/product-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/composition/compose-coding-agent-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/persistence/connection.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/adapters/local/tools/tool-execution-router.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/product-runtime/runtime-logger.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/tool-orchestrator.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/tool-registry-snapshot.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/registry.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/tools/built-ins/index.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/permissions/tool-policy.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/permissions/tool-execution-decision.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/permissions/project-boundary-policy.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-recall-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-runtime-capture.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/memory/memory-management-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/artifacts/artifact-service.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/artifacts/plan-artifact-compatibility.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/workspace/workspace-change-tracker.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/workspace/workspace-restore.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/settings/provider-settings.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/settings/provider-runtime.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/instructions/agent-instruction-source.ts'))).toBe(true);
    expect(existsSync(join(root, 'packages/coding-agent/resources/run-context-service.ts'))).toBe(true);
  });

  it('keeps run orchestration in coding-agent instead of desktop session service', () => {
    const codingAgentRun = sourceUnder('packages/coding-agent/run');
    const desktopServices = sourceUnder('apps/desktop/src/main/services');

    expect(codingAgentRun).toContain('class CodingAgentRunOrchestrator');
    expect(codingAgentRun).toContain('runModelToolLoop');
    expect(codingAgentRun).toContain('buildContinuationInputContext');
    expect(codingAgentRun).toContain('createCodingAgentRunInputFacts');
    expect(existsSync(join(root, 'apps/desktop/src/main/services/session/session-run.service.ts'))).toBe(false);
    expect(desktopServices).not.toContain('new CodingAgentRunOrchestrator');
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
    const instructions = sourceUnder('packages/coding-agent/instructions');
    const resources = sourceUnder('packages/coding-agent/resources');
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
    expect(instructions).toContain('class AgentInstructionSourceService');
    expect(resources).toContain('class RunContextService');

    expect(desktopServices).not.toContain('class MemoryRecallRuntimeService');
    expect(desktopServices).not.toContain('class MemoryRuntimeCaptureService');
    expect(desktopServices).not.toContain('class ArtifactService');
    expect(desktopServices).not.toContain('class WorkspaceChangeTrackerService');
    expect(desktopServices).not.toContain('class WorkspaceRestoreService');
  });

  it('does not place sessions or multi-agent behavior under packages/agent', () => {
    expect(existsSync(join(root, 'packages/agent/session'))).toBe(false);
    expect(existsSync(join(root, 'packages/agent/sessions'))).toBe(false);
    expect(existsSync(join(root, 'packages/agent/multi-agent'))).toBe(false);
  });

  it('keeps tool orchestration and permission policy in coding-agent instead of desktop services', () => {
    const tools = sourceUnder('packages/coding-agent/tools');
    const permissions = sourceUnder('packages/coding-agent/permissions');
    const desktopToolServices = sourceUnder('apps/desktop/src/main/services/tool');

    expect(tools).toContain('createToolOrchestratorService');
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
