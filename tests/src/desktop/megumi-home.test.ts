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
    const settingsSchema = JSON.parse(fs.readFileSync(paths.settingsSchemaPath, 'utf8'));
    expect(settingsSchema).toMatchObject({
      title: 'Megumi settings',
      additionalProperties: false,
      properties: {
        theme: { enum: ['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue'] },
        memory: {
          properties: {
            enabled: { type: 'boolean' },
          },
        },
        providers: {
          properties: {
            deepseek: {
              properties: {
                apiKey: { type: ['string', 'null'], minLength: 1 },
                apiKeyEnv: { type: ['string', 'null'], minLength: 1 },
              },
            },
          },
        },
        permissions: {
          properties: {
            allow: { type: 'array' },
            ask: { type: 'array' },
            deny: { type: 'array' },
          },
        },
      },
    });
  });

  it('refreshes the placeholder settings schema created by earlier src builds', async () => {
    const root = await tempRoot();
    const paths = buildMegumiHomePaths(root);
    fs.mkdirSync(paths.homePath, { recursive: true });
    fs.writeFileSync(paths.settingsSchemaPath, `${JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Megumi settings',
      type: 'object',
      additionalProperties: true,
    }, null, 2)}\n`, 'utf8');

    initializeMegumiHome({
      env: { MEGUMI_HOME: root },
      homeDirectory: os.homedir(),
      now: () => new Date('2026-06-19T00:00:00.000Z'),
    });

    const settingsSchema = JSON.parse(fs.readFileSync(paths.settingsSchemaPath, 'utf8'));
    expect(settingsSchema.additionalProperties).toBe(false);
    expect(settingsSchema.properties.providers.properties.deepseek.properties.defaultModel).toEqual({
      type: 'string',
      minLength: 1,
    });
  });
});
