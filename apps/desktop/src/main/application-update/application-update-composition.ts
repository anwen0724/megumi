/* Composes Desktop updates from NSIS identity, electron-updater and the Home preference store. */
import { app, shell } from 'electron';
import type { DesktopRuntimeLogger } from '../runtime-logger';
import { resolveUpdateSupport } from '../installation/installation-environment';
import { createApplicationUpdateController, type ApplicationUpdateController } from './application-update-controller';
import { ElectronUpdaterAdapter } from './electron-updater-adapter';
import { createFileUpdatePreferencesStore } from './update-preferences-store';

declare const MEGUMI_APP_ID: string;

/** Builds the single update owner after Desktop has resolved its real Home. */
export function composeApplicationUpdate(request: {
  readonly megumiHomePath: string; readonly logger: DesktopRuntimeLogger;
  readonly prepareToQuit: () => Promise<void>;
}): ApplicationUpdateController {
  const supportReason = resolveUpdateSupport({
    isPackaged: app.isPackaged, platform: process.platform, arch: process.arch,
    appId: MEGUMI_APP_ID, version: app.getVersion(), executablePath: app.getPath('exe'), logger: request.logger,
  });
  return createApplicationUpdateController({
    currentVersion: app.getVersion(), platform: process.platform, arch: process.arch, supportReason,
    preferences: createFileUpdatePreferencesStore(request),
    updater: supportReason ? undefined : new ElectronUpdaterAdapter(manualValidationFeed()),
    prepareToQuit: request.prepareToQuit,
    openExternal: url => shell.openExternal(url),
    schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
    now: () => new Date(), logger: request.logger,
  });
}

// Explicit launch flags affect this process only; neither Home nor packaged provider config is written.
function manualValidationFeed(): ConstructorParameters<typeof ElectronUpdaterAdapter>[0] {
  if (!process.argv.includes('--megumi-delivery-validation')) return undefined;
  const urlArgument = process.argv.find(value => value.startsWith('--megumi-validation-url='));
  const githubArgument = process.argv.find(value => value.startsWith('--megumi-validation-github='));
  if (urlArgument && !githubArgument) {
    const url = new URL(urlArgument.slice('--megumi-validation-url='.length));
    if (url.username || url.password || (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
      throw new Error('Validation source must use HTTPS or loopback HTTP without embedded credentials.');
    }
    return { provider: 'generic', url: url.href };
  }
  if (githubArgument && !urlArgument) {
    const match = /^--megumi-validation-github=([\w.-]+)\/([\w.-]+)$/.exec(githubArgument);
    if (match) return { provider: 'github', owner: match[1], repo: match[2] };
  }
  throw new Error('A validation session requires exactly one explicit update source.');
}
