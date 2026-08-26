/*
 * Renders the shared theme-aware Select listbox with keyboard and pointer interaction.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from './class-names';

export interface SelectOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
  readonly description?: string;
}

interface SelectProps<TValue extends string> {
  readonly label: string;
  readonly value: TValue;
  readonly options: readonly SelectOption<TValue>[];
  readonly onValueChange: (value: TValue) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** Renders a controlled Select whose popup follows the active Desktop theme. */
export function Select<TValue extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  className,
}: SelectProps<TValue>) {
  const generatedId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];
  const listboxId = `${generatedId}-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    optionRefs.current[selectedIndex]?.focus();
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, selectedIndex]);

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(nextValue: TValue) {
    onValueChange(nextValue);
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
      <span className="mb-1.5 block text-[0.68rem] font-semibold text-[var(--color-text-muted)]">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        className={cx(
          'flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-3 text-left text-xs font-medium',
          'bg-[var(--color-surface)] text-[var(--color-text)] shadow-[0_1px_0_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,background-color,transform] duration-150',
          'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-elevated)]',
          'active:scale-[0.99] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open
            ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/20'
            : 'border-[var(--color-border)]',
        )}
      >
        <span className="truncate">{selectedOption?.label ?? value}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={cx('shrink-0 text-[var(--color-text-muted)] transition-transform duration-150', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 top-full z-[80] mt-1.5 max-h-72 w-full min-w-48 overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-elevated)] p-1.5 shadow-[var(--shadow-soft)]"
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => choose(option.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className={cx(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs outline-none transition-[background-color,color,transform] duration-100 active:scale-[0.99]',
                  selected
                    ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)] shadow-sm'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface-muted)] focus-visible:bg-[var(--color-surface-muted)]',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="mt-0.5 block truncate text-[0.66rem] opacity-70">
                      {option.description}
                    </span>
                  ) : null}
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
