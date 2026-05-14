import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './class-names';

type IconButtonVariant = 'secondary' | 'ghost' | 'primary';
type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  children: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const variantClassNames: Record<IconButtonVariant, string> = {
  secondary:
    'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)]',
  ghost:
    'border-transparent bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-text)]',
  primary:
    'border-transparent bg-[var(--color-accent)] text-[var(--color-accent-foreground)] hover:brightness-95',
};

const sizeClassNames: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
};

export function IconButton({
  label,
  children,
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50',
        variantClassNames[variant],
        sizeClassNames[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
