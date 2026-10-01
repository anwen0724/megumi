/* Converts electron-updater provider results into Desktop's stable release contract. */
import { NsisUpdater } from 'electron-updater';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'js-yaml';
import { DownloadedUpdateHelper } from 'electron-updater/out/DownloadedUpdateHelper';
import { findFile } from 'electron-updater/out/providers/Provider';
import type { StdioOptions } from 'node:child_process';
import { z, ZodError } from 'zod';
import { ApplicationUpdateReleaseSchema, ApplicationUpdateProgressSchema,
  type ApplicationUpdateProgress,
  type ApplicationUpdateErrorCode } from '../../application-update/application-update-contract';
import { UpdateArtifactSchema, type UpdateCandidate, type UpdateState } from './update-state-store';

/** Carries a stable user-facing failure across the library boundary. */
export class ApplicationUpdateFailure extends Error {
  constructor(readonly code: ApplicationUpdateErrorCode, cause: unknown) {
    super(`${code}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Owns one updater candidate; checking cannot download or arrange an exit-time installation. */
export class ElectronUpdaterAdapter {
  private readonly updater: AwaitableNsisUpdater;
  readonly sourceKey: string | undefined;

  constructor(validationFeed?: { provider: 'generic'; url: string } | { provider: 'github'; owner: string; repo: string }) {
    this.updater = new AwaitableNsisUpdater();
    if (validationFeed) this.updater.setFeedURL(validationFeed);
    // Bind recovery to this configured source without persisting provider credentials.
    this.sourceKey = this.updater.sourceKey(validationFeed);
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.disableWebInstaller = true;
    // Commands below observe the corresponding rejection; EventEmitter still needs a listener.
    this.updater.on('error', () => undefined);
  }

  /** Returns the provider's stable candidate without fetching installer bytes. */
  async check(): Promise<UpdateCandidate | undefined> {
    try {
      const result = await this.updater.checkForUpdates();
      if (!result) throw new ApplicationUpdateFailure('release_metadata_invalid', 'No provider result');
      if (!result.isUpdateAvailable) return undefined;
      const info = result.updateInfo;
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes
        : info.releaseNotes?.map(item => item.note).join('\n');
      const release = ApplicationUpdateReleaseSchema.parse({
        version: info.version,
        title: (info.releaseName?.trim() || `Megumi ${info.version}`).slice(0, 160),
        ...(notes ? { notesSummary: notes.slice(0, 1_200) } : {}),
        releasePageUrl: `https://github.com/anwen0724/megumi/releases/tag/v${info.version}`,
      });
      return { release, artifact: this.updater.candidateArtifact() };
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

  /** Revalidates only local bytes and restores the library's installation state. */
  async restore(state: UpdateState): Promise<void> {
    try {
      await this.updater.restoreCachedInstaller(state);
    } catch (error) {
      if (error instanceof ApplicationUpdateFailure) throw error;
      throw new ApplicationUpdateFailure('update_cache_unreadable', error);
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

  sourceKey(validationFeed: unknown): string | undefined {
    try {
      return createHash('sha256').update(fs.readFileSync(this.app.appUpdateConfigPath))
        .update(JSON.stringify(validationFeed ?? null)).digest('hex');
    } catch { return undefined; }
  }

  candidateArtifact(): UpdateCandidate['artifact'] {
    const checked = this.updateInfoAndProvider;
    const file = checked && findFile(checked.provider.resolveFiles(checked.info), 'exe');
    if (!file || file.packageInfo) throw new ApplicationUpdateFailure('release_assets_incomplete', 'Full installer missing');
    return UpdateArtifactSchema.parse({
      url: file.url.href, fileName: path.basename(decodeURIComponent(file.url.pathname)),
      sha512: file.info.sha512, size: file.info.size,
      isAdminRightsRequired: file.info.isAdminRightsRequired === true,
    });
  }

  // electron-updater 6.6.2 has no public cache-only recovery API. Keep its
  // DownloadedUpdateHelper and protected install state behind this adapter.
  async restoreCachedInstaller(state: UpdateState): Promise<void> {
    const config = z.object({ updaterCacheDirName: z.string().regex(/^[\w.-]+$/) })
      .parse(load(fs.readFileSync(this.app.appUpdateConfigPath, 'utf8')));
    const helper = new DownloadedUpdateHelper(path.join(this.app.baseCachePath, config.updaterCacheDirName));
    const artifact = state.candidate.artifact;
    const filePath = path.join(helper.cacheDirForPendingUpdate, artifact.fileName);
    let cached: unknown;
    try {
      cached = JSON.parse(await fs.promises.readFile(path.join(helper.cacheDirForPendingUpdate, 'update-info.json'), 'utf8'));
      await fs.promises.stat(filePath);
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw new ApplicationUpdateFailure('update_cache_missing', error);
      }
      throw error;
    }
    // The library joins this filename itself; validate it before it can read any path.
    const cacheInfo = z.object({ fileName: z.literal(artifact.fileName) }).safeParse(cached);
    if (!cacheInfo.success) throw new ApplicationUpdateFailure('update_cache_missing', 'Cached target changed');
    const fileInfo = { url: new URL(artifact.url), info: {
      url: artifact.fileName, sha512: artifact.sha512, size: artifact.size,
      isAdminRightsRequired: artifact.isAdminRightsRequired,
    } };
    const info = { version: state.candidate.release.version, files: [fileInfo.info],
      path: artifact.fileName, sha512: artifact.sha512, releaseDate: state.checkedAt };
    const verified = await helper.validateDownloadedPath(filePath, info, fileInfo, this._logger);
    if (!verified) throw new ApplicationUpdateFailure('update_verification_failed', 'Cached installer failed verification');
    await helper.setDownloadedFile(verified, null, info, fileInfo, artifact.fileName, false);
    this.downloadedUpdateHelper = helper;
  }

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
