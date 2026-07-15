/* Lets users preview and persist the Desktop UI language without creating another locale owner. */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '@megumi/product/host-interface';
import { IPC_CHANNELS } from '../ipc/channels';
import { createRendererRuntimeIpcRequest } from '../ipc';
import { cx } from '../ui';
import { applyRendererLanguage, getRendererLanguage } from './locale';
import { localizeRendererError, rendererError, type RendererErrorDescriptor } from './error-localization';

const languageOptions: Array<{ id: AppLanguage; labelKey: 'language.chinese' | 'language.english'; detailKey: 'language.chineseDetail' | 'language.englishDetail' }> = [
  { id: 'zh-CN', labelKey: 'language.chinese', detailKey: 'language.chineseDetail' },
  { id: 'en-US', labelKey: 'language.english', detailKey: 'language.englishDetail' },
];

export function LanguageSelector() {
  const { t } = useTranslation('common');
  const currentLanguage = getRendererLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<RendererErrorDescriptor | null>(null);

  async function selectLanguage(nextLanguage: AppLanguage) {
    if (saving || nextLanguage === currentLanguage) return;
    const previousLanguage = currentLanguage;
    setSaving(true);
    setError(null);
    await applyRendererLanguage(nextLanguage);

    try {
      const result = await window.megumi.settings.update(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, { language: nextLanguage }),
      );
      if (!result.ok) {
        throw rendererError(result.data.code, result.data.message);
      }
      if (result.data.status === 'failed') {
        throw rendererError(result.data.failure.code, result.data.failure.message);
      }
      await applyRendererLanguage(result.data.settings.language);
    } catch (failure) {
      await applyRendererLanguage(previousLanguage);
      setError(isRendererError(failure) ? failure : rendererError('settings_update_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div role="radiogroup" aria-label={t('language.label')} className="grid gap-3 sm:grid-cols-2">
        {languageOptions.map((option) => {
          const selected = currentLanguage === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={saving}
              onClick={() => void selectLanguage(option.id)}
              className={cx(
                'flex min-h-20 items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors',
                selected
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]',
              )}
            >
              <span>
                <span className="block text-sm font-semibold text-[var(--color-text)]">{t(option.labelKey)}</span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{t(option.detailKey)}</span>
              </span>
              {selected ? <Check size={17} className="text-[var(--color-accent)]" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
          {localizeRendererError(error)}
        </p>
      ) : null}
    </div>
  );
}

function isRendererError(value: unknown): value is RendererErrorDescriptor {
  return typeof value === 'object' && value !== null && 'code' in value;
}
