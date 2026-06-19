import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';
import { cx } from './class-names';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function TextField({ label, id, className, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-xs font-medium text-[var(--color-text-muted)]">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={cx(
          'h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-focus)] focus:ring-2 focus:ring-[var(--color-focus)]/20 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}
