import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listSourceFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      return listSourceFiles(relativePath);
    }
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [relativePath] : [];
  });
}

describe('built-in tools and host adapters source guards', () => {
  it('keeps provider-facing tool names platform neutral', () => {
    const definitions = read('packages/tools/built-ins/index.ts');

    expect(definitions).toContain("'run_command'");
    expect(definitions).not.toContain("'powershell'");
    expect(definitions).not.toContain("'shell_run_command'");
    expect(definitions).toContain("'read_file'");
    expect(definitions).not.toContain("'workspace_read_file'");
  });

  it('keeps real filesystem and shell execution out of packages/tools', () => {
    const source = listSourceFiles('packages/tools')
      .map(read)
      .join('\n');

    expect(source).not.toContain("from 'node:fs'");
    expect(source).not.toContain("from 'fs-extra'");
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).not.toContain('spawn(');
  });

  it('keeps Host execution behind PermissionPolicy', () => {
    const handler = read('apps/desktop/src/main/services/tool-use-handler.service.ts');
    const policyIndex = handler.indexOf('evaluatePermissionPolicy({');
    const executeIndex = handler.indexOf('projectExecutor.executeToolCall');

    expect(policyIndex).toBeGreaterThan(-1);
    expect(executeIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeLessThan(executeIndex);
    expect(handler).toContain("decision.decision === 'ask'");
    expect(handler).toContain("decision.decision === 'deny'");
  });

  it('does not introduce MCP, bypass permissions, or TaskIntent into built-in execution', () => {
    const combined = [
      ...listSourceFiles('packages/tools/built-ins'),
      'apps/desktop/src/main/services/tool-use-handler.service.ts',
      'apps/desktop/src/main/services/project-tool-executor.service.ts',
      ...listSourceFiles('apps/desktop/src/main/services/tool-executors'),
    ].map(read).join('\n');

    expect(combined).not.toContain('bypassPermissions');
    expect(combined).not.toContain('dontAsk');
    expect(combined).not.toContain('TaskIntent');
    expect(combined).not.toContain('OutputExpectation');
    expect(combined).not.toContain('Task Mode');
    expect(combined).not.toContain('RunAction.call_tool');
    expect(combined).not.toContain('action-centered');
    expect(combined).not.toContain('mcp_tool_execute');
  });
});
