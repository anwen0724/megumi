/*
 * Contains recommendation management in a modal sidebar with keyboard focus containment.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui';

/** Restores the opener's focus when management closes; child forms own their drafts. */
export function RecommendationManagementDrawer({ children, onClose }: {
  children: ReactNode;
  onClose(): void;
}) {
  const { t } = useTranslation('discovery');
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();
    return () => { if (opener instanceof HTMLElement) opener.focus(); };
  }, []);

  // Contain keyboard navigation while background content is inert.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = panel.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
    );
    const first = elements?.[0];
    const last = elements?.[elements.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-sm"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex h-full w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-app-bg)] text-[var(--color-text)] shadow-2xl outline-none">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5">
        <div><h2 id={titleId} className="text-lg font-semibold">{t('managementTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('managementDescription')}</p></div>
        <Button variant="ghost" size="sm" aria-label={t('closeManagement')} onClick={onClose}><X size={18} aria-hidden="true" /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
    </div>
  </div>;
}
