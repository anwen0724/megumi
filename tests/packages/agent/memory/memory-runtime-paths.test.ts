import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  buildMemoryProjectKey,
  resolveMemoryDiagnosticsPath,
  resolveProjectMemoryMirrorTarget,
  resolveUserMemoryMirrorTarget,
} from '@megumi/agent/adapters/local/memory/memory-runtime-paths';

describe('memory runtime paths', () => {
  const homePath = path.resolve('C:/tmp/megumi-home');

  it('resolves the editable user memory mirror under Megumi Home', () => {
    const target = resolveUserMemoryMirrorTarget({ homePath });

    expect(target).toEqual({
      scope: 'user',
      mirrorId: 'memory:user',
      filePath: path.join(homePath, 'memory', 'user.md'),
      title: 'User Memory',
    });
    expect(target.filePath).not.toContain(`${path.sep}instructions${path.sep}`);
  });

  it('resolves the editable project memory mirror with a stable safe project key', () => {
    const projectId = 'C:\\Projects\\Megumi Demo:中文';
    const target = resolveProjectMemoryMirrorTarget({ homePath, projectId });
    const key = buildMemoryProjectKey(projectId);

    expect(key).toMatch(/^[a-z0-9._-]+-[a-f0-9]{12}$/);
    expect(key).toBe(buildMemoryProjectKey(projectId));
    expect(key).not.toContain(':');
    expect(key).not.toContain('\\');
    expect(key).not.toContain('/');
    expect(target).toEqual({
      scope: 'project',
      projectId,
      mirrorId: `memory:project:${key}`,
      filePath: path.join(homePath, 'memory', 'projects', key, 'memory.md'),
      title: 'Project Memory',
    });
    expect(target.filePath).not.toContain(`${path.sep}instructions${path.sep}`);
  });

  it('keeps project keys deterministic across punctuation, spaces, casing, and non-ascii input', () => {
    const inputs = [
      'C:\\Project With Spaces\\Megumi',
      'C:\\PROJECT WITH SPACES\\Megumi',
      'project:with:colon',
      '项目/中文/路径',
    ];

    const keys = inputs.map(buildMemoryProjectKey);

    expect(new Set(keys).size).toBe(inputs.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9._-]+-[a-f0-9]{12}$/);
      expect(key.length).toBeLessThanOrEqual(77);
    }
  });

  it('resolves diagnostics by UTC date-like prefix from createdAt', () => {
    expect(resolveMemoryDiagnosticsPath({
      homePath,
      createdAt: '2026-06-13T12:34:56.789Z',
    })).toBe(path.join(homePath, 'memory', 'diagnostics', '2026-06-13.jsonl'));
  });
});
