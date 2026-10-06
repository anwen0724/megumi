/*
 * Presents the content-source credential and the model used to prepare candidates.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, KeyRound, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, SecretInput, SettingsPageHeader, SettingsSection, cx } from '../../shared/ui';
import { SupplyModelSettings } from './SupplyModelSettings';
import { WebSettingsPanel } from '../web-settings';

const ZHIHU_SOURCE_ID = 'zhihu';

/** Renders the single content-source credential and the candidate supply model. */
export function ContentSourcesSettingsPanel() {
  const { t } = useTranslation(['settings', 'common']);
  const [configured, setConfigured] = useState(false);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readCredential()
      .then((credential) => {
        if (cancelled) return;
        setConfigured(credential.configured);
        setDraft(credential.credential);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : t('settings:contentSources.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function saveCredential() {
    const credential = draft.trim();
    if (!credential) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.megumi.settings.updateCredential({
        target: { kind: 'discoverySource', sourceId: ZHIHU_SOURCE_ID },
        value: credential,
      });
      if (!result.ok) throw new Error(result.data.message);
      setConfigured(true);
      setDraft(credential);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings:contentSources.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function clearCredential() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.megumi.settings.updateCredential({
        target: { kind: 'discoverySource', sourceId: ZHIHU_SOURCE_ID },
        value: null,
      });
      if (!result.ok) throw new Error(result.data.message);
      const current = await readCredential();
      setConfigured(current.configured);
      setDraft(current.credential);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings:contentSources.clearFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t('settings:categories.sources.label')}
        description={t('settings:categories.sources.description')}
      />

      <SupplyModelSettings />

      <WebSettingsPanel showHeader={false} />

      <SettingsSection
        title={t('settings:contentSources.platformTitle')}
        description={t('settings:contentSources.platformDescription')}
      >
        <CredentialSourceRow
          sourceId={ZHIHU_SOURCE_ID}
          label="知乎 Access Secret"
          helpLink={{
            href: 'https://developer.zhihu.com/',
            label: t('settings:contentSources.zhihuApiLink'),
          }}
          configured={configured}
          value={draft}
          expanded={expanded}
          busy={busy}
          onToggle={() => setExpanded((current) => !current)}
          onChange={setDraft}
          onSave={() => void saveCredential()}
          onClear={() => void clearCredential()}
        />
      </SettingsSection>

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Reads the source secret through the dedicated credential boundary. */
async function readCredential(): Promise<{ configured: boolean; credential: string }> {
  const result = await window.megumi.settings.readCredential({
    target: { kind: 'discoverySource', sourceId: ZHIHU_SOURCE_ID },
  });
  if (!result.ok) throw new Error(result.data.message);
  return {
    configured: result.data.status === 'found',
    credential: result.data.status === 'found' ? result.data.value : '',
  };
}

/** Keeps the source row stable while its credential editor expands inline. */
function CredentialSourceRow(props: {
  sourceId: string;
  label: string;
  helpLink: { readonly href: string; readonly label: string };
  configured: boolean;
  value: string;
  expanded: boolean;
  busy: boolean;
  onToggle(): void;
  onChange(value: string): void;
  onSave(): void;
  onClear(): void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div data-source-id={props.sourceId}>
      <div className="flex min-h-20 items-center justify-between gap-4 px-5 py-4">
        <span className="text-sm font-medium text-[var(--color-text)]">{props.label}</span>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={props.expanded}
          aria-controls={`source-credential-panel-${props.sourceId}`}
          onClick={props.onToggle}
        >
          <Settings2 size={14} aria-hidden="true" />
          {t('contentSources.configure')}
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cx(
              'transition-transform duration-200 motion-reduce:transition-none',
              props.expanded ? 'rotate-180' : undefined,
            )}
          />
        </Button>
      </div>
      <div
        className={cx(
          'grid [overflow-anchor:none] transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          props.expanded ? 'grid-rows-[1fr]' : 'pointer-events-none grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            id={`source-credential-panel-${props.sourceId}`}
            aria-hidden={!props.expanded}
            className={cx(
              'bg-[var(--color-surface-muted)] transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
              props.expanded ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0',
            )}
          >
            <div className="grid grid-cols-1 gap-3 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <SecretInput
                ariaLabel={props.label}
                showLabel={t('provider.showApiKey')}
                hideLabel={t('provider.hideApiKey')}
                value={props.value}
                disabled={props.busy || !props.expanded}
                placeholder={t('contentSources.enterCredential')}
                onChange={props.onChange}
                leadingIcon={<KeyRound size={14} aria-hidden="true" />}
                className="min-w-0"
                inputClassName="h-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20"
              />
              <div className="flex items-center justify-end gap-2">
                <span className="mr-1 text-xs font-medium text-[var(--color-text-muted)]">
                  {props.configured
                    ? t('contentSources.configured')
                    : t('contentSources.notConfigured')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={props.busy || !props.configured || !props.expanded}
                  onClick={props.onClear}
                >
                  {t('contentSources.clear')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={props.busy || !props.value.trim() || !props.expanded}
                  onClick={props.onSave}
                  aria-label={t('contentSources.saveCredentialFor', { name: props.label })}
                >
                  {t('contentSources.save')}
                </Button>
              </div>
            </div>
            <a
              href={props.helpLink.href}
              target="_blank"
              rel="noreferrer"
              tabIndex={props.expanded ? 0 : -1}
              className="flex items-center gap-1 px-5 pb-4 text-xs text-[var(--color-accent)] hover:underline"
            >
              {props.helpLink.label} <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
