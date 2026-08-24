/* Verifies that the headless Evaluation composition root owns a complete lifecycle. */
// @vitest-environment node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvaluationWorkspaceFileSystem } from '../../evals/agent/adapters/scoped-workspace-file-system';
import { createComposeProductEvaluationFactory } from '../../evals/agent/runner/compose-product-runtime-factory';

describe('Evaluation Product composition', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('starts and shuts down the complete headless Composition Root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-evaluation-composition-'));
    temporaryRoots.push(root);
    const homeRoot = path.join(root, 'home');
    const workspaceRoot = path.join(root, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });

    const factory = createComposeProductEvaluationFactory({ requireCredential: false });
    const runtime = await factory.create({
      homeRoot,
      workspaceRoot,
      workspaceFileSystem: await createEvaluationWorkspaceFileSystem(workspaceRoot),
      target: {
        targetId: 'composition:test',
        name: 'Composition test',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      },
      profile: {
        profileId: 'composition:test',
        name: 'Composition test',
        environmentKind: 'controlled',
        permissionMode: 'ask',
        networkAccess: 'disabled',
        isolation: 'workspace_only',
        limits: { wallClockMs: 5_000 },
      },
      isBuiltInToolAvailable: () => false,
    });

    expect(runtime.host).toMatchObject({
      workspace: { useExistingProject: expect.any(Function) },
      chat: { createSession: expect.any(Function), sendUserInput: expect.any(Function) },
      approval: { resolve: expect.any(Function) },
      settings: { get: expect.any(Function) },
    });
    await runtime.dispose();
  }, 15_000);
});
