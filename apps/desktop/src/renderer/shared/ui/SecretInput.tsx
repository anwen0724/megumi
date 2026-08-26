/*
 * Renders a locally persisted credential with masked-by-default reveal controls.
 */
import { Eye, EyeOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cx } from './class-names';

export interface SecretInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly showLabel: string;
  readonly hideLabel: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly leadingIcon?: ReactNode;
  readonly className?: string;
  readonly inputClassName?: string;
}

/** Keeps the value editable while requiring an explicit action to reveal it. */
export function SecretInput(props: SecretInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={cx('relative', props.className)}>
      {props.leadingIcon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]">
          {props.leadingIcon}
        </span>
      ) : null}
      <input
        aria-label={props.ariaLabel}
        type={visible ? 'text' : 'password'}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        autoComplete="off"
        onChange={(event) => props.onChange(event.target.value)}
        className={cx(
          'w-full pr-11',
          props.leadingIcon ? 'pl-9' : undefined,
          props.inputClassName,
        )}
      />
      <button
        type="button"
        aria-label={visible ? props.hideLabel : props.showLabel}
        disabled={props.disabled}
        onClick={() => setVisible((current) => !current)}
        className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
