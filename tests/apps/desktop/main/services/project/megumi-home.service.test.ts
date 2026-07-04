// @vitest-environment node
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMegumiSettingsSchema,
  initializeMegumiHome,
  initializeMegumiHomeSync,
  resolveMegumiHomePath,
  type MegumiHomeFileSystem,
} from '@megumi/desktop/main/services/workspace/megumi-home.service';

class MemoryFileSystem implements MegumiHomeFileSystem {
  readonly directories = new Set<string>();
  readonly jsonFiles = new Map<string, unknown>();
  readonly textFiles = new Map<string, string>();
  readonly existingPaths = new Set<string>();

  async ensureDir(directoryPath: string): Promise<void> {
    this.directories.add(directoryPath);
    this.existingPaths.add(directoryPath);
  }

  async pathExists(filePath: string): Promise<boolean> {
    return (
      this.existingPaths.has(filePath) ||
      this.jsonFiles.has(filePath) ||
      this.textFiles.has(filePath) ||
      this.directories.has(filePath)
    );
  }

  async writeJson(filePath: string, data: unknown): Promise<void> {
    this.jsonFiles.set(filePath, JSON.parse(JSON.stringify(data)));
    this.existingPaths.add(filePath);
  }

  async writeFile(filePath: string, data: string): Promise<void> {
    this.textFiles.set(filePath, data);
    this.existingPaths.add(filePath);
  }
}

describe('Megumi Home foundation', () => {
  let fileSystem: MemoryFileSystem;

  beforeEach(() => {
    fileSystem = new MemoryFileSystem();
  });

  it('resolves the default home directory from the user home directory', () => {
    const homePath = resolveMegumiHomePath({
      env: {},
      homeDirectory: 'C:/Users/anwen',
    });

    expect(homePath).toBe(path.resolve('C:/Users/anwen', '.megumi'));
  });

  it('uses MEGUMI_HOME when the environment override is set', () => {
    const homePath = resolveMegumiHomePath({
      env: {
        MEGUMI_HOME: 'D:/portable/megumi-home',
      },
      homeDirectory: 'C:/Users/anwen',
    });

    expect(homePath).toBe(path.resolve('D:/portable/megumi-home'));
  });

  it('trims MEGUMI_HOME and falls back when it is empty', () => {
    expect(
      resolveMegumiHomePath({
        env: {
          MEGUMI_HOME: '   D:/trimmed/megumi-home   ',
        },
        homeDirectory: 'C:/Users/anwen',
      }),
    ).toBe(path.resolve('D:/trimmed/megumi-home'));

    expect(
      resolveMegumiHomePath({
        env: {
          MEGUMI_HOME: '   ',
        },
        homeDirectory: 'C:/Users/anwen',
      }),
    ).toBe(path.resolve('C:/Users/anwen', '.megumi'));
  });

  it('creates minimal directories and managed metadata without creating default settings.json', async () => {
    const paths = await initializeMegumiHome({
      env: {},
      homeDirectory: 'C:/Users/anwen',
      fileSystem,
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
    });

    expect(paths.homePath).toBe(path.resolve('C:/Users/anwen', '.megumi'));
    expect(paths.settingsPath).toBe(path.join(paths.homePath, 'settings.json'));
    expect(fileSystem.directories).toEqual(
      new Set([
        paths.homePath,
        paths.sqlitePath,
        paths.logsPath,
        paths.cachePath,
        paths.tmpPath,
      ]),
    );

    expect(fileSystem.jsonFiles.has(paths.settingsPath)).toBe(false);
    expect(fileSystem.jsonFiles.get(paths.versionPath)).toEqual({
      version: 1,
      createdAt: '2026-05-11T12:00:00.000Z',
      lastMigration: 'megumi-home-v1',
    });
    expect(fileSystem.jsonFiles.get(paths.settingsSchemaPath)).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Megumi settings',
      type: 'object',
    });
    expect(fileSystem.textFiles.get(paths.readmePath)).toContain('settings.json');
    expect(fileSystem.textFiles.get(paths.readmePath)).toContain('setup');
    expect(fileSystem.textFiles.get(paths.readmePath)).toContain('language');
  });

  it('does not overwrite existing user-managed settings or README files', async () => {
    const homePath = path.resolve('C:/Users/anwen', '.megumi');
    const settingsPath = path.join(homePath, 'settings.json');
    const readmePath = path.join(homePath, 'README.md');

    await fileSystem.writeJson(settingsPath, {
      theme: 'graphite-dark',
    });
    await fileSystem.writeFile(readmePath, 'User edited README');

    const paths = await initializeMegumiHome({
      env: {},
      homeDirectory: 'C:/Users/anwen',
      fileSystem,
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
    });

    expect(fileSystem.jsonFiles.get(paths.settingsPath)).toEqual({
      theme: 'graphite-dark',
    });
    expect(fileSystem.textFiles.get(paths.readmePath)).toBe('User edited README');
  });

  it('exposes optional provider, memory, compaction, and permission rules in the generated settings schema', () => {
    const schema = createMegumiSettingsSchema();

    expect(schema).toMatchObject({
      properties: {
        language: {
          enum: ['zh-CN', 'en-US'],
        },
        setup: {
          type: 'object',
          additionalProperties: false,
          properties: {
            completed: { type: 'boolean' },
          },
        },
        providers: {
          additionalProperties: {
            type: 'object',
            additionalProperties: false,
            properties: {
              base_url: { type: 'string' },
              models: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
              },
              api_key_env: {
                type: ['string', 'null'],
                minLength: 1,
              },
            },
          },
        },
        permissions: {
          type: 'object',
          additionalProperties: false,
          properties: {
            allow: { type: 'array', items: { type: 'object' } },
            ask: { type: 'array', items: { type: 'object' } },
            deny: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    });
  });

  it('supports synchronous initialization for main-process service factories', () => {
    const syncDirectories = new Set<string>();
    const syncJsonFiles = new Map<string, unknown>();
    const syncTextFiles = new Map<string, string>();

    const paths = initializeMegumiHomeSync({
      env: {
        MEGUMI_HOME: 'D:/megumi-home',
      },
      homeDirectory: 'C:/Users/anwen',
      fileSystem: {
        ensureDirSync: (directoryPath) => {
          syncDirectories.add(directoryPath);
        },
        pathExistsSync: (filePath) => syncJsonFiles.has(filePath) || syncTextFiles.has(filePath),
        writeJsonSync: (filePath, data) => {
          syncJsonFiles.set(filePath, data);
        },
        writeFileSync: (filePath, data) => {
          syncTextFiles.set(filePath, data);
        },
      },
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
    });

    expect(paths.homePath).toBe(path.resolve('D:/megumi-home'));
    expect(syncDirectories.has(paths.sqlitePath)).toBe(true);
    expect(syncJsonFiles.has(paths.settingsPath)).toBe(false);
    expect(syncJsonFiles.get(paths.settingsSchemaPath)).toMatchObject({
      title: 'Megumi settings',
    });
    expect(syncTextFiles.get(paths.readmePath)).toContain('Megumi Home');
  });
});
