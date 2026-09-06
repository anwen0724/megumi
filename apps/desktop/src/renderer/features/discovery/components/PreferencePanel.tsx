/*
 * Presents learned preferences inside interest management and preserves user drafts across conflicts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiscoveryPreferenceDetailsPayload, DiscoveryPreferenceDetailsResult, DiscoveryPreferenceEvidenceResult } from '@megumi/product-host/host';
import { createRendererRuntimeIpcRequest } from '../../../shared/ipc';
import { IPC_CHANNELS } from '../../../shared/ipc/channels';
import { Button } from '../../../shared/ui';

type Preference = NonNullable<DiscoveryPreferenceDetailsResult['details']>['preferences'][number]['preference'];
type Draft = { id: string; revision: number; statement: string };

/** Reads only on expansion; mutation results remain authoritative over optimistic local guesses. */
export function PreferencePanel({ scope }: { scope: DiscoveryPreferenceDetailsPayload }) {
  const { t } = useTranslation('discovery');
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState<DiscoveryPreferenceDetailsResult['details']>(null);
  const [draft, setDraft] = useState<Draft>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [evidence, setEvidence] = useState<DiscoveryPreferenceEvidenceResult['details']>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const interestId = scope.scope === 'interest' ? scope.interestId : undefined;

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const payload: DiscoveryPreferenceDetailsPayload = interestId ? { scope: 'interest', interestId } : { scope: 'exploration' };
      const result = await window.megumi.discovery.getPreferenceDetails(createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.preferenceDetails, payload));
      if (!result.ok) throw new Error(t('preferenceReadFailed'));
      if (current === generation.current) setDetails(result.data.details);
      return result.data.details;
    } catch {
      if (current === generation.current) setError(t('preferenceReadFailed'));
      return null;
    }
  }, [interestId, t]);

  useEffect(() => {
    if (expanded) void load();
    return () => { generation.current += 1; };
  }, [expanded, load]);

  /** Saves the captured revision; a conflict refreshes the visible original without losing the draft. */
  async function save(): Promise<void> {
    if (!draft) return;
    setBusy(true); setError(undefined);
    try {
      const result = await window.megumi.discovery.editPreference(createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.preferenceEdit, {
        preferenceId: draft.id, expectedRevision: draft.revision, statement: draft.statement,
      }));
      if (!result.ok) throw new Error(t('preferenceSaveFailed'));
      if (result.data.status === 'revision_conflict') {
        const latest = await load();
        const current = latest?.preferences.find(({ preference }) => preference.id === draft.id)?.preference;
        if (current) setDraft({ ...draft, revision: current.revision });
        setError(t('preferenceConflict'));
        return;
      }
      if (result.data.status !== 'updated' && result.data.status !== 'unchanged') throw new Error(t('preferenceSaveFailed'));
      setDraft(undefined); setEvidence(null); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('preferenceSaveFailed')); }
    finally { setBusy(false); }
  }

  /** Deletes only after a visible confirmation; feedback remains a separate business fact. */
  async function remove(preference: Preference): Promise<void> {
    setBusy(true); setError(undefined);
    try {
      const result = await window.megumi.discovery.deletePreference(createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.preferenceDelete, { preferenceId: preference.id, expectedRevision: preference.revision }));
      if (!result.ok) throw new Error(t('preferenceSaveFailed'));
      if (result.data.status === 'revision_conflict') { await load(); setError(t('preferenceConflict')); return; }
      if (result.data.status === 'not_found') { await load(); setError(t('preferenceMissing')); return; }
      setConfirmDelete(undefined); setEvidence(null); await load();
    } catch { setError(t('preferenceSaveFailed')); }
    finally { setBusy(false); }
  }

  /** Presents the actual feedback separately from the model's inference. */
  async function showEvidence(id: string): Promise<void> {
    setBusy(true); setError(undefined);
    try {
      const result = await window.megumi.discovery.getPreferenceEvidence(createRendererRuntimeIpcRequest(IPC_CHANNELS.discovery.preferenceEvidence, { preferenceId: id }));
      if (!result.ok || !result.data.details) throw new Error(t('preferenceReadFailed'));
      setEvidence(result.data.details);
    } catch { setError(t('preferenceReadFailed')); }
    finally { setBusy(false); }
  }

  return <div className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="cursor-pointer text-[var(--color-text-muted)]">
      {t(interestId ? 'contentPreferences' : 'explorationPreferences')}
    </button>
    {expanded && <div className="mt-3 space-y-3">
      {details?.hasPendingLearning && <p className="text-xs text-[var(--color-text-muted)]">{t('preferencePending')}</p>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setError(undefined); void load(); }}>{t('preferenceRefresh')}</Button>
      {details?.preferences.length === 0 && <p>{t('preferenceEmpty')}</p>}
      {details?.preferences.map(({ preference, validity }) => <div key={preference.id} className="space-y-2 rounded-xl bg-[var(--color-app-bg)] p-3">
        <p className="whitespace-pre-wrap">{preference.statement}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{t(preference.origin === 'user' ? 'preferenceUser' : 'preferenceLearned')}
          {validity !== 'effective' && ` · ${t(validity === 'interest_paused' ? 'preferencePaused' : 'preferenceReview')}`}</p>
        {draft?.id === preference.id ? <div className="space-y-2">
          <label className="block">{t('preferenceDescription')}<textarea aria-label={t('preferenceDescription')} value={draft.statement} disabled={busy}
            onChange={(event) => setDraft({ ...draft, statement: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2" /></label>
          <p className="text-xs">{t('preferenceEditHint')}</p>
          <Button size="sm" disabled={busy || !draft.statement.trim()} onClick={() => void save()}>{t('saveChanges')}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(undefined)}>{t('cancel')}</Button>
        </div> : <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void showEvidence(preference.id)}>{t('preferenceEvidence')}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft({ id: preference.id, revision: preference.revision, statement: preference.statement }); setConfirmDelete(undefined); }}>{t('edit')}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(preference.id)}>{t('delete')}</Button>
        </div>}
        {confirmDelete === preference.id && <div role="group" aria-label={t('preferenceDeleteConfirm')} className="space-y-2">
          <p>{t('preferenceDeleteHint')}</p>
          <Button size="sm" disabled={busy} onClick={() => void remove(preference)}>{t('preferenceDeleteConfirm')}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(undefined)}>{t('cancel')}</Button>
        </div>}
        {evidence?.preferenceId === preference.id && <div className="space-y-2 border-t border-[var(--color-border)] pt-2">
          {evidence.historicalSourceOnly && <p>{t('preferenceHistoricalSource')}</p>}
          {evidence.evidence.map((entry) => <div key={entry.reference.id} className="text-xs leading-5">
            <a href={entry.canonicalUrl} target="_blank" rel="noreferrer" className="underline">{entry.title}</a>
            <p>{entry.sourceName} · {t(entry.currentReaction === 'liked' ? 'preferenceLiked' : entry.currentReaction === 'disliked' ? 'preferenceDisliked' : 'preferenceWithdrawn')}{!entry.current && ` · ${t('preferenceStaleEvidence')}`}</p>
            <p>{entry.reference.explanation ?? t('preferenceNoExplanation')}</p>
            <blockquote>{entry.reference.contentQuote ?? entry.content.contentSummary}</blockquote>
            {entry.content.completeness !== 'full' && <p>{t('preferencePartialContent')}</p>}
          </div>)}
        </div>}
      </div>)}
      {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
    </div>}
  </div>;
}
