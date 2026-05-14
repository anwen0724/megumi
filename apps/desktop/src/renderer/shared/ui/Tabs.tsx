import { cx } from './class-names';

export interface TabItem<TValue extends string> {
  id: TValue;
  label: string;
  disabled?: boolean;
}

interface TabsProps<TValue extends string> {
  ariaLabel: string;
  tabs: TabItem<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  className?: string;
}

export function Tabs<TValue extends string>({
  ariaLabel,
  tabs,
  value,
  onValueChange,
  className,
}: TabsProps<TValue>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx('inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-0.5', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={tab.disabled}
            onClick={() => onValueChange(tab.id)}
            className={cx(
              'rounded px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
