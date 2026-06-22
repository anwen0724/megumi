// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceRoots = ['packages', 'apps'] as const;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) {
    return [];
  }

  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'dist', 'node_modules', 'out', 'coverage'].includes(entry.name)) {
      return [];
    }
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return walk(relativePath);
    }
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [relativePath.replace(/\\/g, '/')] : [];
  });
}

function sourceUnder(relativeDirectory: string): string {
  return walk(relativeDirectory)
    .map((filePath) => fs.readFileSync(path.join(root, filePath), 'utf8'))
    .join('\n');
}

function allProductionSource(): string {
  return sourceRoots.map(sourceUnder).join('\n');
}

describe('runtime lifecycle cleanup final source guards', () => {
  it('keeps ToolUse out of Megumi runtime domain code', () => {
    const source = allProductionSource();

    expect(source).not.toMatch(/\bToolUse\b/);
    expect(source).not.toMatch(/\bToolUseSchema\b/);
    expect(source).not.toMatch(/\bToolUseId\b/);
    expect(source).not.toMatch(/\btoolUseId\b/);
    expect(source).not.toMatch(/\bproviderToolUseId\b/);
    expect(source).not.toContain('tool.use.created');
    expect(source).not.toContain('model.tool_use.detected');
  });

  it('keeps canonical tool schema names on tool_calls and tool_executions', () => {
    const migrations = read('apps/desktop/src/main/persistence/schema/migrations.ts');
    const repository = read('apps/desktop/src/main/persistence/repos/tool.repo.ts');

    expect(migrations).toContain('CREATE TABLE IF NOT EXISTS tool_calls');
    expect(migrations).toContain('CREATE TABLE IF NOT EXISTS tool_executions');
    expect(repository).toContain('saveToolCall');
    expect(repository).toContain('saveToolExecution');
    expect(repository).not.toContain('saveToolUse');
    expect(repository).not.toContain('listToolUsesByRun');
  });

  it('keeps RunContext out of coding-agent context and final budget fields out of RunContext', () => {
    const contextManagement = read('packages/coding-agent/context/model-step-input-context.ts');
    const runContext = read('packages/shared/run/context-contracts.ts');

    expect(contextManagement).not.toContain('@megumi/shared/run');
    expect(contextManagement).not.toContain('runContext?:');
    expect(contextManagement).not.toContain('input.runContext');
    expect(runContext).toContain('contextBudgetPolicy: ContextBudgetPolicySchema');
    expect(runContext).not.toContain('availableInputTokens');
    expect(runContext).not.toContain('ContextBudgetSchema');
  });

  it('keeps model step runtime requests centered on inputContext', () => {
    const source = read('packages/shared/model/step-contracts.ts');

    expect(source).toContain('inputContext: ModelInputContext');
    expect(source).not.toMatch(/\bmessages\?:/);
    expect(source).not.toMatch(/\bcontext\?:\s*RunContext/);
    expect(source).not.toMatch(/\btoolCalls\?:/);
    expect(source).not.toMatch(/\btoolResults\?:/);
    expect(source).not.toMatch(/\bproviderStates\?:/);
    expect(source).not.toMatch(/\bmodeSnapshot\?:/);
  });

  it('keeps legacy workflow and mode snapshot cleanup names out of production source', () => {
    const source = allProductionSource();

    expect(source).not.toMatch(/workflow-command-contracts/);
    expect(source).not.toMatch(/\bWorkflowCommand/);
    expect(source).not.toMatch(/\bworkflow_default\b/);
    expect(source).not.toMatch(/\bmodeSnapshot(Ref)?\b/);
    expect(source).not.toMatch(/\bmode_snapshot(_ref|_id)?\b/);
    expect(source).not.toMatch(/\brun_mode_snapshots\b/);
  });
});
