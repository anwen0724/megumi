/*
 * Presents application identity and truthful update controls from the Main-owned Snapshot.
 */
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import appIconUrl from '../../../../assets/app-icon.ico';
import type { ApplicationUpdateSnapshot } from '../../../application-update/application-update-contract';
import { Button, SettingsPageHeader, SettingsRow, SettingsSection, cx } from '../../shared/ui';
import { useApplicationUpdateStore } from './application-update-store';

/** Renders the standalone Settings About Feature. */
export function AboutMegumiPanel() {
  const { t } = useTranslation('settings');
  const snapshot = useApplicationUpdateStore((state) => state.snapshot);
  const loadError = useApplicationUpdateStore((state) => state.loadError);
  const checkNow = useApplicationUpdateStore((state) => state.checkNow);
  const setAutomaticChecksEnabled = useApplicationUpdateStore(
    (state) => state.setAutomaticChecksEnabled,
  );
  const setAutomaticDownloadsEnabled = useApplicationUpdateStore(
    (state) => state.setAutomaticDownloadsEnabled,
  );
  const downloadUpdate = useApplicationUpdateStore((state) => state.downloadUpdate);
  const restartAndInstall = useApplicationUpdateStore((state) => state.restartAndInstall);
  const openReleasePage = useApplicationUpdateStore((state) => state.openReleasePage);

  if (!snapshot) {
    return (
      <div className="space-y-6">
        <SettingsPageHeader
          title={t('categories.about.label')}
          description={t('categories.about.description')}
        />
        <SettingsSection>
          <div role="status" className="flex items-center gap-3 p-5 text-sm text-[var(--color-text-muted)]">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {loadError ? t('about.loadFailed') : t('about.loading')}
          </div>
        </SettingsSection>
      </div>
    );
  }

  const preferencesDisabled = snapshot.status === 'unsupported' || snapshot.status === 'installing';
  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('categories.about.label')}
        description={t('categories.about.description')}
      />

      <SettingsSection>
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
          <img
            src={appIconUrl}
            alt="Megumi"
            className="size-16 shrink-0 rounded-2xl shadow-sm"
          />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-[var(--color-text)]">Megumi</h2>
            <p className="mt-1 text-sm font-medium text-[var(--color-text)]">{t('about.tagline')}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
              {t('about.description')}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-[var(--color-text-muted)]">
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2.5 py-1">
                {t('about.version', { version: snapshot.currentVersion })}
              </span>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2.5 py-1">
                {platformLabel(snapshot.platform, snapshot.arch)}
              </span>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('about.updateTitle')}
        description={t('about.updateDescription')}
      >
        <div className="divide-y divide-[var(--color-border)]">
          <SettingsRow
            title={t('about.automaticChecks')}
            description={t('about.automaticChecksDescription')}
          >
            <div className="flex justify-end">
              <UpdateSwitch
                checked={snapshot.automaticChecksEnabled}
                disabled={preferencesDisabled}
                label={t('about.automaticChecks')}
                onCheckedChange={(enabled) => { void setAutomaticChecksEnabled(enabled); }}
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title={t('about.automaticDownloads')}
            description={snapshot.automaticChecksEnabled
              ? t('about.automaticDownloadsDescription')
              : t('about.automaticDownloadsRequiresChecks')}
          >
            <div className="flex justify-end">
              <UpdateSwitch
                checked={snapshot.automaticDownloadsEnabled}
                disabled={preferencesDisabled || !snapshot.automaticChecksEnabled}
                label={t('about.automaticDownloads')}
                onCheckedChange={(enabled) => { void setAutomaticDownloadsEnabled(enabled); }}
              />
            </div>
          </SettingsRow>
        </div>

        <UpdateStatusCard
          snapshot={snapshot}
          onCheck={() => { void checkNow(); }}
          onDownload={() => { void downloadUpdate(); }}
          onRestart={() => { void restartAndInstall(); }}
          onOpenRelease={() => { void openReleasePage(); }}
        />
      </SettingsSection>

      <SettingsSection title={t('about.projectTitle')} description={t('about.projectDescription')}>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">{t('about.openSource')}</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('about.license')}</p>
          </div>
          <Button variant="secondary" onClick={() => { void openReleasePage(); }}>
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('about.openReleases')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}

/** Combines the current status explanation, Release details, and its single primary action. */
function UpdateStatusCard({
  snapshot,
  onCheck,
  onDownload,
  onRestart,
  onOpenRelease,
}: {
  readonly snapshot: ApplicationUpdateSnapshot;
  readonly onCheck: () => void;
  readonly onDownload: () => void;
  readonly onRestart: () => void;
  readonly onOpenRelease: () => void;
}) {
  const { t } = useTranslation('settings');
  const presentation = statusPresentation(snapshot, t);
  const StatusIcon = presentation.icon;
  const releaseVisible = 'releasePageUrl' in snapshot && Boolean(snapshot.releasePageUrl);
  const lastCheckedAt = checkedAt(snapshot);
  return (
    <div className="border-t border-[var(--color-border)] p-5">
      <div
        role={snapshot.status === 'error' ? 'alert' : 'status'}
        className={cx(
          'rounded-xl border p-4',
          snapshot.status === 'error'
            ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface-muted)]',
        )}
      >
        <div className="flex items-start gap-3">
          <StatusIcon
            className={cx(
              'mt-0.5 size-5 shrink-0',
              presentation.spinning ? 'animate-spin motion-reduce:animate-none' : undefined,
              snapshot.status === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-accent)]',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">{presentation.title}</h3>
            <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">{presentation.description}</p>
            {lastCheckedAt ? (
              <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
                {t('about.lastChecked', { time: new Date(lastCheckedAt).toLocaleString() })}
              </p>
            ) : null}
          </div>
        </div>

        {'notesSummary' in snapshot && snapshot.notesSummary ? (
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">
              {t('about.releaseNotes')}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-muted)]">
              {snapshot.notesSummary}
            </p>
          </div>
        ) : null}

        {snapshot.status === 'ready' ? (
          <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">{t('about.trayExitHint')}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <PrimaryUpdateAction
            snapshot={snapshot}
            onCheck={onCheck}
            onDownload={onDownload}
            onRestart={onRestart}
            onOpenRelease={onOpenRelease}
          />
          {releaseVisible ? (
            <Button variant="ghost" onClick={onOpenRelease}>
              <ExternalLink className="size-4" aria-hidden="true" />
              {t('about.viewRelease')}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Selects exactly one primary command from the Main-owned discriminated state. */
function PrimaryUpdateAction({
  snapshot,
  onCheck,
  onDownload,
  onRestart,
  onOpenRelease,
}: {
  readonly snapshot: ApplicationUpdateSnapshot;
  readonly onCheck: () => void;
  readonly onDownload: () => void;
  readonly onRestart: () => void;
  readonly onOpenRelease: () => void;
}) {
  const { t } = useTranslation('settings');
  switch (snapshot.status) {
    case 'unsupported':
      return <Button variant="primary" onClick={onOpenRelease}>{t('about.openReleases')}</Button>;
    case 'idle':
    case 'up_to_date':
      return (
        <Button variant="primary" onClick={onCheck}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t('about.checkNow')}
        </Button>
      );
    case 'available':
      return (
        <Button variant="primary" onClick={onDownload}>
          <Download className="size-4" aria-hidden="true" />
          {t('about.downloadUpdate')}
        </Button>
      );
    case 'ready':
      return (
        <Button variant="primary" onClick={onRestart}>
          <PackageCheck className="size-4" aria-hidden="true" />
          {t('about.restartAndUpdate')}
        </Button>
      );
    case 'error':
      return snapshot.retryable ? (
        <Button variant="primary" onClick={onCheck}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t('about.retryCheck')}
        </Button>
      ) : <Button variant="primary" onClick={onOpenRelease}>{t('about.openReleases')}</Button>;
    case 'checking':
      return <ProgressButton label={t('about.checking')} />;
    case 'downloading':
      return <ProgressButton label={t('about.downloading')} />;
    case 'installing':
      return <ProgressButton label={t('about.installing')} />;
  }
}

/** Presents truthful indeterminate work without exposing a second interactive update command. */
function ProgressButton({ label }: { readonly label: string }) {
  return (
    <Button variant="primary" disabled>
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </Button>
  );
}

function UpdateSwitch({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        'relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
          : 'border-[var(--color-border-strong)] bg-[var(--color-surface-muted)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-5 rounded-full bg-white shadow-sm transition-transform duration-150 motion-reduce:transition-none',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// Maps every mutually exclusive Main state to one textual and icon-supported user explanation.
function statusPresentation(
  snapshot: ApplicationUpdateSnapshot,
  t: TFunction<'settings'>,
) {
  switch (snapshot.status) {
    case 'unsupported':
      return {
        icon: AlertCircle,
        title: t('about.status.unsupported'),
        description: t(`about.unsupported.${snapshot.reason}`),
      };
    case 'idle':
      return { icon: RefreshCw, title: t('about.status.idle'), description: t('about.status.idleDescription') };
    case 'checking':
      return { icon: LoaderCircle, spinning: true, title: t('about.status.checking'), description: t('about.status.checkingDescription') };
    case 'up_to_date':
      return { icon: CheckCircle2, title: t('about.status.upToDate'), description: t('about.status.upToDateDescription') };
    case 'available':
      return { icon: Download, title: t('about.status.available', { version: snapshot.targetVersion }), description: t('about.status.availableDescription') };
    case 'downloading':
      return { icon: LoaderCircle, spinning: true, title: t('about.status.downloading', { version: snapshot.targetVersion }), description: t('about.status.downloadingDescription') };
    case 'ready':
      return { icon: PackageCheck, title: t('about.status.ready', { version: snapshot.targetVersion }), description: t('about.status.readyDescription') };
    case 'installing':
      return { icon: LoaderCircle, spinning: true, title: t('about.status.installing'), description: t('about.status.installingDescription') };
    case 'error':
      return { icon: AlertCircle, title: t('about.status.error'), description: t(`about.errors.${snapshot.errorCode}`) };
  }
}

function checkedAt(snapshot: ApplicationUpdateSnapshot): string | undefined {
  if ('checkedAt' in snapshot) return snapshot.checkedAt;
  if ('lastCheckedAt' in snapshot) return snapshot.lastCheckedAt;
  return undefined;
}

function platformLabel(platform: string, arch: string): string {
  const platformName = platform === 'win32'
    ? 'Windows'
    : platform === 'darwin'
      ? 'macOS'
      : platform === 'linux'
        ? 'Linux'
        : platform;
  return `${platformName} ${arch}`;
}
