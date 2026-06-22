import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('19.03 tool orchestration contract guards', () => {
  it('keeps public tool execution mode values to parallel and serial', () => {
    const contracts = read('packages/shared/tool/contracts.ts');

    expect(contracts).toContain("TOOL_EXECUTION_MODES = ['parallel', 'serial']");
    expect(contracts).not.toContain('parallel_eligible');
    expect(contracts).not.toContain("'sequential'");
    expect(contracts).not.toContain("'exclusive'");
    expect(contracts).not.toContain("'concurrent'");
  });

  it('does not introduce unapproved orchestration persistence models', () => {
    const migrations = read('apps/desktop/src/main/persistence/schema/migrations.ts');
    const repository = read('apps/desktop/src/main/persistence/repos/tool.repo.ts');

    for (const source of [migrations, repository]) {
      expect(source).not.toContain('tool_call_batches');
      expect(source).not.toMatch(/\bphase[_-]?table\b/i);
      expect(source).not.toMatch(/\bresource[_-]?graph\b/i);
    }
  });

  it('keeps renderer projection on 19.03 execution status names', () => {
    const dispatcher = read('apps/desktop/src/renderer/features/runtime-events/runtime-event-dispatcher.ts');
    const statusCard = read('apps/desktop/src/renderer/entities/tool-call/ToolCallStatusCard.tsx');

    for (const source of [dispatcher, statusCard]) {
      expect(source).not.toContain('pending_approval');
      expect(source).not.toContain("'completed'");
      expect(source).not.toContain("'denied'");
    }
  });
});
