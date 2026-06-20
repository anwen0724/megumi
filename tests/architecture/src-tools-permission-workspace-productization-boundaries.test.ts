import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('src tools permission workspace productization boundaries', () => {
  it('keeps desktop handlers as adapters and projections, not owner rule implementations', () => {
    const files = [
      'src/desktop/ipc/handlers/tool.handler.ts',
      'src/desktop/ipc/handlers/workspace-files.handler.ts',
      'src/desktop/ipc/handlers/recovery.handler.ts',
      'src/desktop/renderer-protocol/productization/productization.ts',
    ].map(read).join('\n');

    expect(files).not.toContain('evaluatePermissionPolicy(');
    expect(files).not.toContain('preflightToolCall(');
    expect(files).not.toContain('createToolExecutionService(');
    expect(files).not.toContain('createAgentRunner(');
    expect(files).not.toContain('buildModelContextInput');
    expect(files).not.toContain('streamAssistantMessage');
  });

  it('keeps owner modules independent from database and desktop implementation details', () => {
    const ownerFiles = [
      'src/tools/execution-service.ts',
      'src/tools/repository.ts',
      'src/permission/repository.ts',
      'src/workspace/manager.ts',
      'src/workspace/repository.ts',
    ].map(read).join('\n');

    expect(ownerFiles).not.toContain('../database');
    expect(ownerFiles).not.toContain('../../database');
    expect(ownerFiles).not.toContain('better-sqlite3');
    expect(ownerFiles).not.toContain('electron');
    expect(ownerFiles).not.toContain('@megumi/');
    expect(ownerFiles).not.toContain('apps/desktop');
    expect(ownerFiles).not.toContain('packages/');
  });

  it('keeps Plan 6 entrypoints while leaving delayed backends out of scope', () => {
    expect(read('forge.config.ts')).toContain('src/desktop/main.ts');
    expect(read('forge.config.ts')).toContain('src/desktop/preload/index.ts');
    expect(read('vite.main.config.ts')).toContain("path.resolve(__dirname, 'src/desktop')");
    expect(read('vite.preload.config.ts')).toContain("path.resolve(__dirname, 'src/desktop')");
    expect(read('vite.renderer.config.ts')).toContain("root: 'src/ui'");

    const changedScope = [
      'src/desktop/ipc/register-handlers.ts',
      'src/desktop/preload/megumi-api.ts',
    ].map(read).join('\n');
    expect(changedScope).toContain('tool.list');
    expect(changedScope).not.toContain('artifacts.write');
    expect(changedScope).not.toContain('memory.capture');
  });
});
