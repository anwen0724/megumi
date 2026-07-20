/* Renders the compact, theme-aware listbox controls used by the Composer toolbar. */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from '../../../shared/ui';

export type ComposerSelectOption<TValue extends string> = {
  value: TValue;
  label: string;
  meta?: string;
};

type ComposerSelectProps<TValue extends string> = {
  id: string;
  label: string;
  value: TValue;
  options: ComposerSelectOption<TValue>[];
  disabled?: boolean;
  icon: ReactNode;
  warning?: boolean;
  className?: string;
  menuClassName?: string;
  onChange: (value: TValue) => void;
};

export function ComposerSelect<TValue extends string>({
  id,
  label,
  value,
  options,
  disabled = false,
  icon,
  warning = false,
  className,
  menuClassName,
  onChange,
}: ComposerSelectProps<TValue>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    optionRefs.current[selectedIndex]?.focus();
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, selectedIndex]);

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(nextValue: TValue) {
    onChange(nextValue);
    closeAndRestoreFocus();
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') nextIndex = Math.min(options.length - 1, index + 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div ref={rootRef} className={cx('relative min-w-0', className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        value={value}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        className={cx(
          'group flex h-8 max-w-full items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-55',
          open
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)] ring-1 ring-[var(--color-accent)]/30'
            : 'hover:bg-[var(--color-surface-muted)]',
          warning ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]',
        )}
      >
        <span className="shrink-0" aria-hidden="true">{icon}</span>
        <span className={cx('min-w-0 truncate', warning ? 'text-[var(--color-warning)]' : 'text-[var(--color-text)]')}>
          {selectedOption?.label ?? value}
        </span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={cx('shrink-0 transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label={label}
          className={cx(
            'absolute bottom-full right-0 z-[70] mb-1.5 max-h-64 w-max min-w-44 max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg',
            'border border-[var(--color-border-strong)] bg-[var(--color-surface-elevated)] p-1 shadow-[var(--shadow-soft)]',
            menuClassName,
          )}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                value={option.value}
                role="option"
                aria-selected={selected}
                onClick={() => choose(option.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className={cx(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none transition-colors',
                  selected
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] shadow-sm'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] focus-visible:bg-[var(--color-surface-muted)]',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.label}</span>
                  {option.meta ? <span className="mt-0.5 block truncate text-[0.68rem] opacity-70">{option.meta}</span> : null}
                </span>
                <Check size={14} aria-hidden="true" className={cx('shrink-0', !selected && 'invisible')} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
