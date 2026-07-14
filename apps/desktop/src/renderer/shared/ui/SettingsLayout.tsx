/* Provides the shared visual hierarchy used by every Settings pane. */
import type { ReactNode } from 'react';
import { cx } from './class-names';

export function SettingsPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--color-text)]">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]',
        className,
      )}
    >
      {title || description ? (
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          {title ? (
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-5 text-[var(--color-text-muted)]">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)] md:items-center',
        className,
      )}
    >
      <div>
        <h3 className="text-sm font-medium text-[var(--color-text)]">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 md:justify-self-stretch">{children}</div>
    </div>
  );
}
