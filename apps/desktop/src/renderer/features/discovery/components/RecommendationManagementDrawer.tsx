/*
 * Contains recommendation management in a modal sidebar with keyboard focus containment.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../shared/ui';

/** Restores the opener's focus when management closes; child forms own their drafts. */
export function RecommendationManagementDrawer({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose(): void;
}) {
  const { t } = useTranslation('discovery');
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const exitAnimation = useRef<Animation | null>(null);
  const backdropExitAnimation = useRef<Animation | null>(null);

  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();
    return () => {
      exitAnimation.current?.cancel();
      backdropExitAnimation.current?.cancel();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Keep the modal mounted and the background inert until the exit finishes.
  function closeDrawer() {
    if (exitAnimation.current) return;

    const element = panel.current;
    if (!element?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }

    const style = window.getComputedStyle(element);
    const options: KeyframeAnimationOptions = {
      duration: 180,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    };
    // Start at the current position when the user closes during the entrance.
    exitAnimation.current = element.animate(
      [
        {
          transform: style.transform,
          opacity: style.opacity,
        },
        {
          transform: 'translateX(100%)',
          opacity: 0,
        },
      ],
      options,
    );
    backdropExitAnimation.current =
      backdrop.current?.animate(
        [{ opacity: window.getComputedStyle(backdrop.current).opacity }, { opacity: 0 }],
        options,
      ) ?? null;
    element.inert = true;
    void exitAnimation.current.finished.then(onClose, () => {
      // Unmounting cancels the animation; it must not close the next page.
    });
  }

  // Contain keyboard navigation while background content is inert.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;

    const elements = panel.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
    );
    const first = elements?.[0];
    const last = elements?.[elements.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === panel.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={backdrop}
      className="ui-overlay-enter fixed inset-0 z-40 flex justify-end overflow-hidden bg-black/30 backdrop-blur-sm"
      onClick={event => {
        if (event.target === event.currentTarget) closeDrawer();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="ui-drawer-enter flex h-full w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-app-bg)] text-[var(--color-text)] shadow-2xl outline-none"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] px-6 py-5">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              {t('managementTitle')}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t('managementDescription')}
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label={t('closeManagement')} onClick={closeDrawer}>
            <X size={18} aria-hidden="true" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
