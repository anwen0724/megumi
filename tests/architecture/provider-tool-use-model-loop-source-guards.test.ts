import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('provider tool use model loop source guards', () => {
  it('keeps provider loop centered on ToolUse and ToolResult', () => {
    const toolLoop = read('packages/core/run-runtime/tool-loop.ts');

    expect(toolLoop).toContain('ToolUseHandlerPort');
    expect(toolLoop).toContain('tool.use.created');
    expect(toolLoop).toContain('tool.result.created');
    expect(toolLoop).toContain('toolResults');
  });

  it('does not reintroduce RunAction.call_tool as the model tool path', () => {
    const sessionRun = read('apps/desktop/src/main/services/session-run.service.ts');
    const toolLoop = read('packages/core/run-runtime/tool-loop.ts');

    expect(sessionRun).not.toContain("actionKind: 'call_tool'");
    expect(toolLoop).not.toContain('RunAction');
    expect(toolLoop).not.toContain('handleAction');
  });

  it('does not implement real built-in tools or permission policy in Plan 2 code paths', () => {
    const toolLoop = read('packages/core/run-runtime/tool-loop.ts');
    const sessionRun = read('apps/desktop/src/main/services/session-run.service.ts');

    expect(toolLoop).not.toContain('readFileSync');
    expect(toolLoop).not.toContain('writeFileSync');
    expect(toolLoop).not.toContain('spawn');
    expect(toolLoop).not.toContain('execFile');
    expect(sessionRun).not.toContain('PermissionPolicy');
  });
});
