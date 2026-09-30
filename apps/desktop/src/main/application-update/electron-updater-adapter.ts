/* Converts electron-updater provider results into Desktop's stable release contract. */
import { NsisUpdater } from 'electron-updater';
import { app } from 'electron';
import type { StdioOptions } from 'node:child_process';
import { ZodError } from 'zod';
import { ApplicationUpdateReleaseSchema, ApplicationUpdateProgressSchema,
  type ApplicationUpdateRelease, type ApplicationUpdateProgress,
  type ApplicationUpdateErrorCode } from '../../application-update/application-update-contract';

/** Carries a stable user-facing failure across the library boundary. */
export class ApplicationUpdateFailure extends Error {
  constructor(readonly code: ApplicationUpdateErrorCode, cause: unknown) {
    super(`${code}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Owns one updater candidate; checking cannot download or arrange an exit-time installation. */
export class ElectronUpdaterAdapter {
  private readonly updater: AwaitableNsisUpdater;

  constructor(validationFeed?: { provider: 'generic'; url: string } | { provider: 'github'; owner: string; repo: string }) {
    this.updater = new AwaitableNsisUpdater();
    if (validationFeed) this.updater.setFeedURL(validationFeed);
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.disableWebInstaller = true;
    // Commands below observe the corresponding rejection; EventEmitter still needs a listener.
    this.updater.on('error', () => undefined);
  }

  /** Returns the provider's stable candidate without fetching installer bytes. */
  async check(): Promise<ApplicationUpdateRelease | undefined> {
    try {
      const result = await this.updater.checkForUpdates();
      if (!result) throw new ApplicationUpdateFailure('release_metadata_invalid', 'No provider result');
      if (!result.isUpdateAvailable) return undefined;
      const info = result.updateInfo;
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes
        : info.releaseNotes?.map(item => item.note).join('\n');
      return ApplicationUpdateReleaseSchema.parse({
        version: info.version,
        title: (info.releaseName?.trim() || `Megumi ${info.version}`).slice(0, 160),
        ...(notes ? { notesSummary: notes.slice(0, 1_200) } : {}),
        releasePageUrl: `https://github.com/anwen0724/megumi/releases/tag/v${info.version}`,
      });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (error instanceof ApplicationUpdateFailure) throw error;
      if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'
        || code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') {
        throw new ApplicationUpdateFailure('release_assets_incomplete', error);
      }
      if (typeof code === 'string' && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) {
        throw new ApplicationUpdateFailure('network_unavailable', error);
      }
      if (error instanceof Error && error.message.startsWith('net::ERR_')) {
        throw new ApplicationUpdateFailure('network_unavailable', error);
      }
      if (error instanceof Error && 'statusCode' in error) {
        throw new ApplicationUpdateFailure('update_service_unavailable', error);
      }
      throw new ApplicationUpdateFailure(error instanceof ZodError || code === 'ERR_UPDATER_INVALID_UPDATE_INFO'
        || code === 'ERR_UPDATER_INVALID_VERSION' ? 'release_metadata_invalid' : 'unknown_update_error', error);
    }
  }

  /** Downloads and verifies the already checked candidate through the same updater instance. */
  async download(onProgress: (progress: ApplicationUpdateProgress) => void): Promise<void> {
    const listener = (progress: { percent: number; transferred: number; total: number }) => {
      const parsed = ApplicationUpdateProgressSchema.safeParse({
        percent: progress.percent, transferred: progress.transferred, total: progress.total,
      });
      if (parsed.success) onProgress(parsed.data);
    };
    this.updater.on('download-progress', listener);
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      throw new ApplicationUpdateFailure(code === 'ERR_CHECKSUM_MISMATCH' || code === 'ERR_UPDATER_INVALID_SIGNATURE'
        ? 'update_verification_failed' : 'update_download_failed', error);
    } finally {
      this.updater.removeListener('download-progress', listener);
    }
  }

  /** Hands the verified full installer to electron-updater after shutdown preparation. */
  async install(): Promise<void> {
    await this.updater.launchInstaller();
    app.quit();
  }
}

// BaseUpdater.install owns the verified cache and NSIS arguments. Await its protected
// process boundary instead of quitAndInstall, which schedules quit before spawn failures arrive.
class AwaitableNsisUpdater extends NsisUpdater {
  private installerStart: Promise<boolean> | undefined;

  /** Waits for OS process creation and leaves failed handoffs retryable. */
  async launchInstaller(): Promise<void> {
    this.installerStart = undefined;
    try {
      if (!this.install(true, true) || !this.installerStart) {
        throw new ApplicationUpdateFailure('update_not_ready', 'No verified installer');
      }
      await this.installerStart;
    } catch (error) {
      this.quitAndInstallCalled = false;
      throw error;
    }
  }

  protected override spawnLog(command: string, args?: string[], env?: NodeJS.ProcessEnv, stdio?: StdioOptions): Promise<boolean> {
    this.installerStart = super.spawnLog(command, args, env, stdio).catch(error => {
      // This per-user delivery must not silently retry via elevation or shell.openPath.
      throw new ApplicationUpdateFailure('installer_launch_failed', error);
    });
    return this.installerStart;
  }
}
