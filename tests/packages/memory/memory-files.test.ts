// @vitest-environment node
import { expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryFiles } from '@megumi/application/memory/memory-files';

it('publishes versioned text and rejects stale edits, read-only inputs and paths outside memory', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'memory-files-'));
  const files = createMemoryFiles(path.join(parent, 'memories'));
  try {
    const first = files.writeFinal(
      {
        path: 'MEMORY.md',
        content: 'First',
        expectedVersion: 'absent',
      },
      () => {},
    );
    expect(files.read('MEMORY.md')).toEqual(first);
    expect(() =>
      files.writeFinal(
        {
          path: 'MEMORY.md',
          content: 'Lost update',
          expectedVersion: 'absent',
        },
        () => {},
      ),
    ).toThrow('VERSION_CONFLICT');
    expect(() =>
      files.writeFinal(
        {
          path: '../AGENTS.md',
          content: 'escape',
          expectedVersion: 'absent',
        },
        () => {},
      ),
    ).toThrow('PATH_DENIED');
    expect(() =>
      files.writeFinal(
        {
          path: 'raw_memories.md',
          content: 'replace input',
          expectedVersion: 'absent',
        },
        () => {},
      ),
    ).toThrow('PATH_DENIED');
    expect(() =>
      files.writeFinal(
        {
          path: 'skills/test/SKILL.md',
          content: 'bad\0text',
          expectedVersion: 'absent',
        },
        () => {},
      ),
    ).toThrow('OUTPUT_INVALID');
    files.writeInput('raw_memories.md', ['input\n', 'second'], () => {});
    expect(files.read('raw_memories.md')).toMatchObject({
      readOnly: true,
      content: 'input\nsecond',
    });
    expect(() =>
      files.writeFinal(
        {
          path: 'MEMORY.md',
          content: 'denied',
          expectedVersion: first.version,
        },
        () => {
          throw new Error('OWNER_LOST');
        },
      ),
    ).toThrow('OWNER_LOST');
    expect(files.read('MEMORY.md')?.content).toBe('First');
    files.writeInput('rollout_summaries/source.md', ['source'], () => {});
    const temporary = path.join(
      parent,
      'memories',
      'MEMORY.md.00000000-0000-0000-0000-000000000000.tmp',
    );
    writeFileSync(temporary, 'interrupted write');
    files.clear(() => {});
    expect(files.hasArtifacts()).toBe(false);
    expect(existsSync(temporary)).toBe(false);
  } finally {
    rmSync(parent, {
      recursive: true,
      force: true,
    });
  }
});

it('rejects linked ancestors for reads, writes and clear without touching the target', () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'memory-links-'));
  try {
    const root = path.join(parent, 'memories');
    const outside = path.join(parent, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    mkdirSync(path.join(root, 'skills'));
    writeFileSync(path.join(outside, 'SKILL.md'), 'keep');
    symlinkSync(outside, path.join(root, 'skills', 'escape'), 'junction');
    const files = createMemoryFiles(root);
    expect(() => files.read('skills/escape/SKILL.md')).toThrow('PATH_DENIED');
    expect(() =>
      files.writeFinal(
        {
          path: 'skills/escape/SKILL.md',
          content: 'overwrite',
          expectedVersion: 'absent',
        },
        () => {},
      ),
    ).toThrow('PATH_DENIED');
    expect(() => files.clear(() => {})).toThrow('PATH_DENIED');
    expect(readFileSync(path.join(outside, 'SKILL.md'), 'utf8')).toBe('keep');
  } finally {
    rmSync(parent, {
      recursive: true,
      force: true,
    });
  }
});
