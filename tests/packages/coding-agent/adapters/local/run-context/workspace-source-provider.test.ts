// @vitest-environment node
// Verifies the product's local workspace source provider lists files under a
// workspace root with correct redaction/selection metadata, replacing the dead
// desktop adapter. This keeps run-context workspace sources a product capability.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalWorkspaceSourceProvider } from '@megumi/coding-agent/adapters/local/run-context/workspace-source-provider';

describe('local workspace source provider', () => {
  let workspace: string | undefined;

  afterEach(async () => {
    if (workspace) {
      await rm(workspace, { recursive: true, force: true });
      workspace = undefined;
    }
  });

  it('lists workspace files with redaction and selection metadata', async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'megumi-workspace-sources-'));
    await writeFile(path.join(workspace, 'README.md'), '# hello', 'utf8');
    await writeFile(path.join(workspace, '.env'), 'SECRET=1', 'utf8');
    await writeFile(path.join(workspace, 'service.key'), 'key-material', 'utf8');

    const provider = createLocalWorkspaceSourceProvider();
    const sources = provider.listWorkspaceSources({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: workspace,
      loadedAt: '2026-06-24T00:00:00.000Z',
    });

    const byName = new Map(sources.map((source) => [source.relativePath, source]));
    expect(new Set(byName.keys())).toEqual(new Set(['README.md', '.env', 'service.key']));

    const readme = byName.get('README.md');
    expect(readme?.redactionState).toBe('none');
    expect(readme?.selectionReason).toBe('agent_requested');
    expect(readme?.sourceKind).toBe('workspace_file');
    expect(readme?.sourceUri).toBe('workspace://workspace-1/README.md');
    expect(readme?.workspaceId).toBe('workspace-1');
    expect(readme?.freshness).toBe('fresh');
    expect(readme?.loadedAt).toBe('2026-06-24T00:00:00.000Z');
    expect(readme?.metadata).toMatchObject({ runId: 'run-1', contentLoaded: false });

    expect(byName.get('.env')?.redactionState).toBe('blocked');
    expect(byName.get('.env')?.selectionReason).toBe('context_policy');
    expect(byName.get('service.key')?.redactionState).toBe('blocked');
    expect(byName.get('service.key')?.selectionReason).toBe('context_policy');
  });

  it('ignores directories and only returns files', async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'megumi-workspace-sources-dir-'));
    await writeFile(path.join(workspace, 'top.txt'), 'top', 'utf8');
    await mkdtemp(path.join(workspace, 'nested-'));

    const provider = createLocalWorkspaceSourceProvider();
    const sources = provider.listWorkspaceSources({
      runId: 'run-2',
      workspaceId: 'workspace-2',
      workspacePath: workspace,
      loadedAt: '2026-06-24T00:00:00.000Z',
    });

    expect(sources.map((source) => source.relativePath)).toEqual(['top.txt']);
  });
});
