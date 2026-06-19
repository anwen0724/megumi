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
      'src/desktop/ipc/tool.handler.ts',
      'src/desktop/ipc/workspace-files.handler.ts',
      'src/desktop/ipc/recovery.handler.ts',
      'src/desktop/mappers/productization.mapper.ts',
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

  it('keeps Plan 5 out of entrypoint switching and delayed backends', () => {
    expect(read('forge.config.ts')).toContain('apps/desktop');
    expect(read('vite.main.config.ts')).toContain('apps/desktop');
    expect(read('vite.preload.config.ts')).toContain('apps/desktop');
    expect(read('vite.renderer.config.ts')).toContain('apps/desktop');

    const changedScope = [
      'src/desktop/ipc/register-handlers.ts',
      'src/desktop/preload/megumi-api.ts',
    ].map(read).join('\n');
    expect(changedScope).toContain('tool.list');
    expect(changedScope).not.toContain('artifacts.write');
    expect(changedScope).not.toContain('memory.capture');
  });
});
