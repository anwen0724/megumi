/*
 * Presents actionable Desktop bootstrap failures before any Product runtime is started.
 */
import path from 'node:path';
import { app, dialog } from 'electron';
import {
  DatabaseDowngradeUnsupportedError,
  DatabaseMigrationError,
  DatabaseReleaseUpgradeError,
} from '@megumi/database';

interface DesktopBootstrapFailurePresentation {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
}

/** Shows the blocking recovery dialog for known database upgrade failures. */
export async function showDesktopBootstrapFailure(error: unknown): Promise<boolean> {
  const presentation = describeDesktopBootstrapFailure(error);
  if (!presentation) return false;
  await app.whenReady();
  await dialog.showMessageBox({
    type: 'error',
    title: presentation.title,
    message: presentation.message,
    detail: presentation.detail,
    buttons: ['退出 Megumi'],
    defaultId: 0,
    noLink: true,
  });
  return true;
}

/** Converts typed Database failures into user-safe recovery instructions. */
export function describeDesktopBootstrapFailure(
  error: unknown,
): DesktopBootstrapFailurePresentation | undefined {
  if (error instanceof DatabaseDowngradeUnsupportedError) {
    return {
      title: 'Megumi 无法使用此数据库',
      message: '当前 Megumi 版本早于这个数据库所需的版本。',
      detail: recoveryDetail({
        databaseFile: error.databaseFile,
        reason: '请安装版本更高的 Megumi 后重新启动。为避免损坏数据，当前版本不会继续写入。',
      }),
    };
  }
  if (error instanceof DatabaseMigrationError) {
    return {
      title: 'Megumi 数据升级失败',
      message: '数据升级未完成，Megumi 不会继续进入正常运行。',
      detail: recoveryDetail({
        databaseFile: error.databaseFile,
        backupFile: error.backupFile,
        reason: '原数据库没有被自动替换。请退出，并在获得修复版本后重新启动。',
      }),
    };
  }
  if (error instanceof DatabaseReleaseUpgradeError) {
    return {
      title: 'Megumi 无法安全升级数据',
      message: '升级前备份或校验没有完成，数据库迁移尚未继续。',
      detail: recoveryDetail({
        databaseFile: error.databaseFile,
        backupFile: error.backupFile,
        reason: '请保留现有文件并退出，在检查磁盘空间或获得修复版本后重试。',
      }),
    };
  }
  return undefined;
}

function recoveryDetail(request: {
  readonly databaseFile: string;
  readonly backupFile?: string;
  readonly reason: string;
}): string {
  const diagnosticDirectory = path.join(path.dirname(path.dirname(request.databaseFile)), 'logs');
  return [
    request.reason,
    '',
    `数据库：${request.databaseFile}`,
    `最近备份：${request.backupFile ?? '本次升级没有生成可用备份'}`,
    `诊断目录：${diagnosticDirectory}`,
  ].join('\n');
}
