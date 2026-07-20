// @vitest-environment node
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMegumiHomePaths,
  createMegumiSettingsSchema,
  initializeMegumiHome,
  initializeMegumiHomeSync,
  resolveMegumiHomePath,
  type MegumiHomeFileSystem,
} from '@megumi/product/home';

class MemoryFileSystem implements MegumiHomeFileSystem {
  readonly directories = new Set<string>();
  readonly jsonFiles = new Map<string, unknown>();
  readonly textFiles = new Map<string, string>();
  readonly existingPaths = new Set<string>();
  readonly copiedDirectories: Array<{ sourcePath: string; targetPath: string }> = [];
  readonly removedDirectories: string[] = [];
  readonly movedDirectories: Array<{ sourcePath: string; targetPath: string }> = [];
  failCopyDirectory = false;

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

  async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    if (this.failCopyDirectory) {
      throw new Error('copy failed');
    }
    this.copiedDirectories.push({ sourcePath, targetPath });
    this.existingPaths.add(targetPath);
  }

  async removeDirectory(directoryPath: string): Promise<void> {
    this.removedDirectories.push(directoryPath);
    this.existingPaths.delete(directoryPath);
    this.directories.delete(directoryPath);
  }

  async moveDirectory(sourcePath: string, targetPath: string): Promise<void> {
    this.movedDirectories.push({ sourcePath, targetPath });
    this.existingPaths.delete(sourcePath);
    this.directories.delete(sourcePath);
    this.existingPaths.add(targetPath);
  }
}

describe('Megumi Home', () => {
  let fileSystem: MemoryFileSystem;

  beforeEach(() => {
    fileSystem = new MemoryFileSystem();
  });

  it('resolves the default home directory from the user home directory', () => {
    const homePath = resolveMegumiHomePath({
      env: {},
      homeDirectory: 'C:/Users/tester',
    });

    expect(homePath).toBe(path.resolve('C:/Users/tester', '.megumi'));
  });

  it('uses MEGUMI_HOME when the environment override is set', () => {
    const homePath = resolveMegumiHomePath({
      env: {
        MEGUMI_HOME: 'D:/portable/megumi-home',
      },
      homeDirectory: 'C:/Users/tester',
    });

    expect(homePath).toBe(path.resolve('D:/portable/megumi-home'));
  });

  it('builds the product home layout including skills and system skills', () => {
    const paths = buildMegumiHomePaths('D:/megumi-home');

    expect(paths).toMatchObject({
      homePath: path.resolve('D:/megumi-home'),
      skillsPath: path.join(path.resolve('D:/megumi-home'), 'skills'),
      systemSkillsPath: path.join(path.resolve('D:/megumi-home'), 'skills', '.system'),
      settingsPath: path.join(path.resolve('D:/megumi-home'), 'settings.json'),
      sqlitePath: path.join(path.resolve('D:/megumi-home'), 'sqlite'),
      attachmentsPath: path.join(path.resolve('D:/megumi-home'), 'attachments'),
    });
  });

  it('creates managed product directories and metadata without creating default settings.json', async () => {
    const paths = await initializeMegumiHome({
      env: {},
      homeDirectory: 'C:/Users/tester',
      fileSystem,
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
    });

    expect(paths.homePath).toBe(path.resolve('C:/Users/tester', '.megumi'));
    expect(fileSystem.directories).toEqual(new Set([
      paths.homePath,
      paths.skillsPath,
      paths.systemSkillsPath,
      paths.sqlitePath,
      paths.logsPath,
      paths.cachePath,
      paths.tmpPath,
      paths.attachmentsPath,
    ]));
    expect(fileSystem.jsonFiles.has(paths.settingsPath)).toBe(false);
    expect(fileSystem.jsonFiles.get(paths.versionPath)).toEqual({
      version: 1,
      createdAt: '2026-05-11T12:00:00.000Z',
      lastMigration: 'megumi-home-v1',
    });
    expect(fileSystem.textFiles.get(paths.readmePath)).toContain('skills/.system');
  });

  it('replaces the managed system Skill directory only after the new copy is ready', async () => {
    const seedPath = path.resolve('C:/repo/packages/skills/built-in-skills');
    const existingSystemSkillsPath = buildMegumiHomePaths(path.resolve('C:/Users/tester', '.megumi')).systemSkillsPath;
    fileSystem.existingPaths.add(seedPath);
    fileSystem.existingPaths.add(existingSystemSkillsPath);

    const paths = await initializeMegumiHome({
      env: {},
      homeDirectory: 'C:/Users/tester',
      fileSystem,
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
      resourceLocator: {
        resolveBuiltInSystemSkillsPath: () => seedPath,
      },
    });

    expect(fileSystem.copiedDirectories).toEqual([{
      sourcePath: seedPath,
      targetPath: `${paths.systemSkillsPath}.staging`,
    }]);
    expect(fileSystem.movedDirectories).toEqual([
      {
        sourcePath: paths.systemSkillsPath,
        targetPath: `${paths.systemSkillsPath}.backup`,
      },
      {
        sourcePath: `${paths.systemSkillsPath}.staging`,
        targetPath: paths.systemSkillsPath,
      },
    ]);
    expect(fileSystem.removedDirectories).toEqual([`${paths.systemSkillsPath}.backup`]);
  });

  it('preserves the existing system Skill directory when preparing the replacement fails', async () => {
    const seedPath = path.resolve('C:/repo/packages/skills/built-in-skills');
    const existingSystemSkillsPath = buildMegumiHomePaths(path.resolve('C:/Users/tester', '.megumi')).systemSkillsPath;
    fileSystem.existingPaths.add(seedPath);
    fileSystem.existingPaths.add(existingSystemSkillsPath);
    fileSystem.failCopyDirectory = true;

    const initialization = initializeMegumiHome({
      env: {},
      homeDirectory: 'C:/Users/tester',
      fileSystem,
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
      resourceLocator: {
        resolveBuiltInSystemSkillsPath: () => seedPath,
      },
    });

    await expect(initialization).rejects.toThrow('copy failed');
    const paths = buildMegumiHomePaths(path.resolve('C:/Users/tester', '.megumi'));
    expect(await fileSystem.pathExists(paths.systemSkillsPath)).toBe(true);
    expect(fileSystem.movedDirectories).toEqual([]);
  });

  it('does not infer built-in skill resources from the repository working directory', async () => {
    const defaultSeedPath = path.resolve(process.cwd(), 'packages', 'skills', 'built-in-skills');
    fileSystem.existingPaths.add(defaultSeedPath);

    const paths = await initializeMegumiHome({
      env: {},
      homeDirectory: 'C:/Users/tester',
      fileSystem,
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
    });

    expect(paths.systemSkillsPath).toBe(path.join(paths.homePath, 'skills', '.system'));
    expect(fileSystem.copiedDirectories).toEqual([]);
  });

  it('supports synchronous initialization for host composition', () => {
    const syncDirectories = new Set<string>();
    const syncJsonFiles = new Map<string, unknown>();
    const syncTextFiles = new Map<string, string>();
    const copiedDirectories: Array<{ sourcePath: string; targetPath: string }> = [];
    const existingPaths = new Set<string>();
    const movedDirectories: Array<{ sourcePath: string; targetPath: string }> = [];
    const seedPath = path.resolve('C:/repo/packages/skills/built-in-skills');
    const existingSystemSkillsPath = buildMegumiHomePaths(path.resolve('D:/megumi-home')).systemSkillsPath;
    existingPaths.add(seedPath);
    existingPaths.add(existingSystemSkillsPath);

    const paths = initializeMegumiHomeSync({
      env: {
        MEGUMI_HOME: 'D:/megumi-home',
      },
      homeDirectory: 'C:/Users/tester',
      fileSystem: {
        ensureDirSync: (directoryPath) => {
          syncDirectories.add(directoryPath);
          existingPaths.add(directoryPath);
        },
        pathExistsSync: (filePath) => existingPaths.has(filePath) || syncJsonFiles.has(filePath) || syncTextFiles.has(filePath),
        writeJsonSync: (filePath, data) => {
          syncJsonFiles.set(filePath, data);
        },
        writeFileSync: (filePath, data) => {
          syncTextFiles.set(filePath, data);
        },
        copyDirectorySync: (sourcePath, targetPath) => {
          copiedDirectories.push({ sourcePath, targetPath });
          existingPaths.add(targetPath);
        },
        removeDirectorySync: (directoryPath) => {
          existingPaths.delete(directoryPath);
        },
        moveDirectorySync: (sourcePath, targetPath) => {
          movedDirectories.push({ sourcePath, targetPath });
          existingPaths.delete(sourcePath);
          existingPaths.add(targetPath);
        },
      },
      clock: {
        now: () => new Date('2026-05-11T12:00:00.000Z'),
      },
      resourceLocator: {
        resolveBuiltInSystemSkillsPath: () => seedPath,
      },
    });

    expect(paths.homePath).toBe(path.resolve('D:/megumi-home'));
    expect(existingPaths.has(paths.systemSkillsPath)).toBe(true);
    expect(syncJsonFiles.get(paths.settingsSchemaPath)).toMatchObject({
      title: 'Megumi settings',
    });
    expect(copiedDirectories).toEqual([{
      sourcePath: seedPath,
      targetPath: `${paths.systemSkillsPath}.staging`,
    }]);
    expect(movedDirectories).toEqual([
      { sourcePath: paths.systemSkillsPath, targetPath: `${paths.systemSkillsPath}.backup` },
      { sourcePath: `${paths.systemSkillsPath}.staging`, targetPath: paths.systemSkillsPath },
    ]);
  });

  it('exposes the generated settings schema from the product core', () => {
    expect(createMegumiSettingsSchema()).toMatchObject({
      title: 'Megumi settings',
      type: 'object',
    });
  });
});
