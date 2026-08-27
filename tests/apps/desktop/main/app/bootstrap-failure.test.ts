/*
 * Verifies typed Database bootstrap failures become safe recovery guidance.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DatabaseDowngradeUnsupportedError,
  DatabaseMigrationError,
  DatabaseReleaseUpgradeError,
} from '@megumi/database';

vi.mock('electron', () => ({
  app: { whenReady: vi.fn().mockResolvedValue(undefined) },
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
}));

describe('Desktop bootstrap failure presentation', () => {
  it('includes the preserved backup and diagnostic location after migration failure', async () => {
    const { describeDesktopBootstrapFailure } = await import('@megumi/desktop/main/app/bootstrap-failure');
    const failure = describeDesktopBootstrapFailure(new DatabaseMigrationError({
      databaseFile: 'C:\\Megumi\\sqlite\\megumi.sqlite',
      migrationsFolder: 'C:\\Megumi\\migrations',
      migration: '0017_update',
      backupFile: 'C:\\Megumi\\sqlite\\backups\\before.sqlite',
      reason: 'sql_migration_failed',
    }));

    expect(failure?.message).toContain('数据升级未完成');
    expect(failure?.detail).toContain('before.sqlite');
    expect(failure?.detail).toContain('logs');
    expect(failure?.detail).toContain('没有被自动替换');
  });

  it.each([
    new DatabaseDowngradeUnsupportedError({
      databaseFile: 'C:\\Megumi\\sqlite\\megumi.sqlite',
      databaseMigrationCount: 3,
      supportedMigrationCount: 2,
    }),
    new DatabaseReleaseUpgradeError({
      databaseFile: 'C:\\Megumi\\sqlite\\megumi.sqlite',
      reason: 'backup_creation_failed',
    }),
  ])('recognizes every blocking release-upgrade failure', async (error) => {
    const { describeDesktopBootstrapFailure } = await import('@megumi/desktop/main/app/bootstrap-failure');
    expect(describeDesktopBootstrapFailure(error)).toBeDefined();
  });

  it('does not disguise an unrelated bootstrap exception as a database recovery case', async () => {
    const { describeDesktopBootstrapFailure } = await import('@megumi/desktop/main/app/bootstrap-failure');
    expect(describeDesktopBootstrapFailure(new Error('other'))).toBeUndefined();
  });
});
