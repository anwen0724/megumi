import type { ButtonHTMLAttributes } from 'react';
import { cx } from './class-names';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClassNames: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-[var(--color-accent)] text-[var(--color-accent-foreground)] hover:brightness-95',
  secondary:
    'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]',
  ghost:
    'border-transparent bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-text)]',
  danger:
    'border-transparent bg-[var(--color-danger)] text-white hover:brightness-95',
};

const sizeClassNames: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50',
        variantClassNames[variant],
        sizeClassNames[size],
        className,
      )}
      {...props}
    />
  );
}
