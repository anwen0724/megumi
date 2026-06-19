import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cx('rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]', className)}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3', className)}
      {...props}
    />
  );
}

export function PanelTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cx('text-sm font-semibold text-[var(--color-text)]', className)} {...props} />;
}
