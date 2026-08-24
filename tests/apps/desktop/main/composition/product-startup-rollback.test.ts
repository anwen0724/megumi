// @vitest-environment node
/* Verifies that Product composition rolls back already-open resources after a later startup failure. */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  close: vi.fn(),
  create: vi.fn(),
  migrate: vi.fn(),
}));

vi.mock('@megumi/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@megumi/database')>()),
  createDatabase: database.create,
  migrateDatabase: database.migrate,
}));

import {
  composeProductCapabilities,
  type ProductCapabilitiesOptions,
} from '@megumi/desktop/main/shell-composition/harness-capabilities';
import { createNodeWorkspaceFileSystem } from '@megumi/workspace/node';

const tempDirectories: string[] = [];

afterEach(() => {
  database.close.mockReset();
  database.create.mockReset();
  database.migrate.mockReset();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Product startup rollback', () => {
  it('closes the opened Database and preserves the original later composition error', () => {
    const root = mkdtempSync(join(tmpdir(), 'megumi-product-startup-'));
    tempDirectories.push(root);
    const connection = { close: database.close };
    database.create.mockReturnValue(connection);
    const startupFailure = new Error('later composition failed');
    const options = {
      home: {
        env: { MEGUMI_HOME: join(root, 'home') },
        homeDirectory: root,
        fileSystem: {
          ensureDirSync: fs.ensureDirSync,
          pathExistsSync: fs.pathExistsSync,
          writeJsonSync: fs.writeJsonSync,
          writeFileSync: fs.writeFileSync,
          copyDirectorySync: fs.copySync,
        },
        clock: { now: () => new Date('2026-08-02T00:00:00.000Z') },
      },
      workspaceFileSystem: createNodeWorkspaceFileSystem(),
    } satisfies Omit<ProductCapabilitiesOptions, 'modelStreams'>;
    Object.defineProperty(options, 'modelStreams', {
      get: () => {
        throw startupFailure;
      },
    });

    expect(() => composeProductCapabilities(options as ProductCapabilitiesOptions)).toThrow(startupFailure);
    expect(database.close).toHaveBeenCalledTimes(1);
  });
});
