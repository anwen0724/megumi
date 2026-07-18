import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ArtifactContentStore } from '@megumi/agent/artifacts/artifact-content-store';

const root = path.join(process.cwd(), '.tmp', 'artifact-content-store-test');

describe('ArtifactContentStore', () => {
  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores small content inline and larger content in Megumi Home without exposing absolute paths', async () => {
    const store = new ArtifactContentStore({
      artifactRoot: root,
      inlineTextLimitBytes: 12,
      now: () => '2026-05-16T00:00:00.000Z',
    });

    const inline = await store.writeText({
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:1',
      text: 'hello',
      mimeType: 'text/plain',
    });
    const stored = await store.writeText({
      artifactId: 'artifact:1',
      artifactVersionId: 'artifact-version:2',
      text: 'this content is larger than the inline limit',
      mimeType: 'text/plain',
    });

    expect(inline.storage).toBe('inline');
    expect(inline.inlineText).toBe('hello');
    expect(stored.storage).toBe('megumi_home');
    expect(stored.contentKey).toBe('artifact_1/artifact-version_2/content.txt');
    expect(JSON.stringify(stored)).not.toContain(root);
  });

  it('rejects unsafe ids before writing files', async () => {
    const store = new ArtifactContentStore({
      artifactRoot: root,
      inlineTextLimitBytes: 1,
      now: () => '2026-05-16T00:00:00.000Z',
    });

    await expect(store.writeText({
      artifactId: '../artifact',
      artifactVersionId: 'artifact-version:1',
      text: 'unsafe',
      mimeType: 'text/plain',
    })).rejects.toThrow('Unsafe artifact content id.');
  });
});

