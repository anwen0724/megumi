// @vitest-environment node
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultMegumiConfig,
  initializeMegumiHome,
  initializeMegumiHomeSync,
  resolveMegumiHomePath,
  type MegumiHomeFileSystem,
} from '@megumi/desktop/main/services/megumi-home.service';

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

  it('creates the minimal Megumi Home directory structure and default files', async () => {
    const paths = await initializeMegumiHome({
      env: {},
      homeDirectory: 'C:/Users/anwen',
      fileSystem,
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
    });

    expect(paths.homePath).toBe(path.resolve('C:/Users/anwen', '.megumi'));
    expect(fileSystem.directories).toEqual(
      new Set([
        paths.homePath,
        paths.sqlitePath,
        paths.secretsPath,
        paths.providerSecretsPath,
        paths.logsPath,
        paths.cachePath,
        paths.tmpPath,
      ]),
    );

    expect(fileSystem.jsonFiles.get(paths.configPath)).toEqual(createDefaultMegumiConfig());
    expect(fileSystem.jsonFiles.get(paths.versionPath)).toEqual({
      version: 1,
      createdAt: '2026-05-11T12:00:00.000Z',
      lastMigration: 'megumi-home-v1',
    });
    expect(fileSystem.jsonFiles.get(paths.configSchemaPath)).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Megumi config',
      type: 'object',
    });
    expect(fileSystem.textFiles.get(paths.readmePath)).toContain('Megumi Home');
    expect(fileSystem.textFiles.get(paths.readmePath)).toContain('MEGUMI_HOME');
  });

  it('does not overwrite existing user-managed files', async () => {
    const homePath = path.resolve('C:/Users/anwen', '.megumi');
    const configPath = path.join(homePath, 'config.json');
    const readmePath = path.join(homePath, 'README.md');

    await fileSystem.writeJson(configPath, {
      version: 1,
      app: {
        theme: 'custom-theme',
      },
      chat: {
        defaultProvider: 'openai',
      },
      providers: {},
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

    expect(fileSystem.jsonFiles.get(paths.configPath)).toEqual({
      version: 1,
      app: {
        theme: 'custom-theme',
      },
      chat: {
        defaultProvider: 'openai',
      },
      providers: {},
    });
    expect(fileSystem.textFiles.get(paths.readmePath)).toBe('User edited README');
  });

  it('creates a single-file config with provider defaults and no duplicated chat model', () => {
    const config = createDefaultMegumiConfig();

    expect(config.chat).toEqual({
      defaultProvider: 'deepseek',
    });
    expect(config.providers.deepseek).toMatchObject({
      enabled: true,
      kind: 'openai-compatible',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    });
    expect(config.providers.openai).toMatchObject({
      defaultModel: 'gpt-5.5',
      apiKeyEnv: 'OPENAI_API_KEY',
    });
    expect(config.providers.anthropic).toMatchObject({
      enabled: false,
      kind: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
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
    expect(syncDirectories.has(paths.providerSecretsPath)).toBe(true);
    expect(syncJsonFiles.get(paths.configPath)).toEqual(createDefaultMegumiConfig());
    expect(syncTextFiles.get(paths.readmePath)).toContain('Megumi Home');
  });
});
