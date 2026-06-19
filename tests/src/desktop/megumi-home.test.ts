// @vitest-environment node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMegumiHomePaths,
  initializeMegumiHome,
  resolveMegumiHomePath,
} from '../../../src/desktop/infrastructure/megumi-home';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'megumi-home-src-'));
  roots.push(root);
  return root;
}

describe('megumi home infrastructure', () => {
  it('resolves MEGUMI_HOME override before the user home default', () => {
    expect(resolveMegumiHomePath({ env: { MEGUMI_HOME: 'C:/custom/megumi' }, homeDirectory: 'C:/Users/me' }))
      .toBe(path.resolve('C:/custom/megumi'));
    expect(resolveMegumiHomePath({ env: {}, homeDirectory: 'C:/Users/me' }))
      .toBe(path.resolve('C:/Users/me', '.megumi'));
  });

  it('initializes the expected desktop home paths without creating database schema', async () => {
    const root = await tempRoot();
    const paths = initializeMegumiHome({
      env: { MEGUMI_HOME: root },
      homeDirectory: os.homedir(),
      now: () => new Date('2026-06-19T00:00:00.000Z'),
    });

    expect(paths).toEqual(buildMegumiHomePaths(root));
    for (const directory of [paths.homePath, paths.sqlitePath, paths.logsPath, paths.cachePath, paths.tmpPath]) {
      expect(fs.statSync(directory).isDirectory()).toBe(true);
    }
    expect(JSON.parse(fs.readFileSync(paths.versionPath, 'utf8'))).toEqual({
      version: 1,
      createdAt: '2026-06-19T00:00:00.000Z',
      lastMigration: 'megumi-home-v1',
    });
    expect(fs.readFileSync(paths.readmePath, 'utf8')).toContain('# Megumi Home');
    expect(fs.readFileSync(paths.settingsSchemaPath, 'utf8')).toContain('Megumi settings');
  });
});
