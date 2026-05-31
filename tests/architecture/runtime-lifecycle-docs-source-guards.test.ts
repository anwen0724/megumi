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
    const architecture = read('.local-docs/architecture/agent-runtime-architecture.md');

    expect(architecture).toContain('tool-call-centered');
    expect(architecture).toContain('ToolCall');
    expect(architecture).toContain('ToolExecution');
    expect(architecture).toContain('UserTurn');
    expect(architecture).not.toContain('ToolUse 是工具主链路源头');
    expect(architecture).not.toContain('tool-use-centered');
    expect(architecture).not.toContain('ToolUse -> PermissionPolicy -> ApprovalRequest? -> ToolCall');
  });

  it('records that old local development DB data can be rebuilt instead of migrated', () => {
    const spec = read('.local-docs/specs/08-runtime-lifecycle-and-contract-cleanup/01-runtime-lifecycle-and-contract-cleanup.md');
    const activeWork = read('.local-docs/status/active-work.md');

    expect(spec).toContain('如果旧开发库不兼容，接受重建本地开发 DB。');
    expect(activeWork).toContain('旧本地开发 DB 如因 08 schema 或 RunContext JSON shape 变化不兼容，接受清空或重建');
  });

  it('keeps project status aligned with completed 08 cleanup', () => {
    const status = read('.local-docs/PROJECT_STATUS.md');
    const activeWork = read('.local-docs/status/active-work.md');
    const milestoneHistory = read('.local-docs/status/milestone-history.md');

    expect(status).toContain('08 Runtime Lifecycle and Contract Cleanup');
    expect(status).toContain('ToolCall / ToolExecution');
    expect(status).toContain('RunContext 职责收缩');
    expect(activeWork).toContain('08 Runtime Lifecycle and Contract Cleanup');
    expect(milestoneHistory).toContain('08 Runtime Lifecycle and Contract Cleanup');
  });
});
