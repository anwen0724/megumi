/*
 * Presents first-use cost consent with contained keyboard focus and explicit user actions.
 */
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui';

/** Renders the first-supply confirmation; dismissing never implies consent. */
export function FirstSupplyConfirmationDialog({ busy, error, onDefer, onConfirm }: {
  busy: boolean;
  error: string | null;
  onDefer(): void;
  onConfirm(): void;
}) {
  const { t } = useTranslation('discovery');
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  // Keep keyboard interaction inside the modal, including while both action buttons are disabled.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onDefer();
    }
    if (event.key !== 'Tab') return;
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const first = buttons?.[0];
    const last = buttons?.[buttons.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget && !busy) onDefer(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        aria-busy={busy} tabIndex={-1} onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text)] shadow-xl outline-none">
        <h2 id={titleId} className="text-lg font-semibold">{t('firstSupplyTitle')}</h2>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{t('firstSupplyDescription')}</p>
        {error ? <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" disabled={busy} onClick={onDefer}>{t('deferFirstSupply')}</Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>{t('startFirstSupply')}</Button>
        </div>
      </div>
    </div>
  );
}
