// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('runtime lifecycle docs source guards', () => {
  it('keeps current architecture docs on ToolCall and ToolExecution language', () => {
    const architecture = [
      read('.local-docs/architecture/refs/agent-platform-host-architecture.md'),
      read('.local-docs/specs/20-project-architecture-rebuild/02-agent-run-main-chain.md'),
    ].join('\n');

    expect(architecture).toContain('Tool Call');
    expect(architecture).toContain('Tool Execution');
    expect(architecture).toContain('Permission Policy');
    expect(architecture).toContain('tool.call.created');
    expect(architecture).toContain('tool.execution.started');
    expect(architecture).not.toContain('ToolUse 是工具主链路源头');
    expect(architecture).not.toContain('tool-use-centered');
    expect(architecture).not.toContain('ToolUse -> PermissionPolicy -> ApprovalRequest? -> ToolCall');
  });

  it('records that old local development DB data can be rebuilt instead of migrated', () => {
    const spec = read('.local-docs/specs/08-runtime-lifecycle-and-contract-cleanup/01-runtime-lifecycle-and-contract-cleanup.md');
    const implementedCapabilities = read('.local-docs/status/implemented-capabilities.md');

    expect(spec).toContain('如果旧开发库不兼容，接受重建本地开发 DB。');
    expect(implementedCapabilities).toContain('旧开发库不兼容时接受重建本地开发 DB');
  });

  it('keeps project status aligned with completed 08 cleanup', () => {
    const implementedCapabilities = read('.local-docs/status/implemented-capabilities.md');

    expect(implementedCapabilities).toContain('08 Runtime Lifecycle and Contract Cleanup');
    expect(implementedCapabilities).toContain('ToolCall / ToolExecution');
    expect(implementedCapabilities).toContain('RunContext 职责收缩');
  });
});
