import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'approval';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClassNames: Record<BadgeVariant, string> = {
  neutral: 'border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
  accent: 'border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  success: 'border-transparent bg-[var(--color-success-soft)] text-[var(--color-success)]',
  warning: 'border-transparent bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  danger: 'border-transparent bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  approval: 'border-transparent bg-[var(--color-approval-soft)] text-[var(--color-approval)]',
};

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        variantClassNames[variant],
        className,
      )}
      {...props}
    />
  );
}
