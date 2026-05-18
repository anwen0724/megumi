import { type KeyboardEvent, useRef } from 'react';
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

function nextEnabledIndex<TValue extends string>(
  tabs: TabItem<TValue>[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (tabs.length === 0) {
    return currentIndex;
  }

  let index = currentIndex;

  for (let attempts = 0; attempts < tabs.length; attempts += 1) {
    index = (index + direction + tabs.length) % tabs.length;

    if (!tabs[index]?.disabled) {
      return index;
    }
  }

  return currentIndex;
}

function firstEnabledIndex<TValue extends string>(tabs: TabItem<TValue>[]): number {
  return tabs.findIndex((tab) => !tab.disabled);
}

function lastEnabledIndex<TValue extends string>(tabs: TabItem<TValue>[]): number {
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    if (!tabs[index]?.disabled) {
      return index;
    }
  }

  return -1;
}

export function Tabs<TValue extends string>({
  ariaLabel,
  tabs,
  value,
  onValueChange,
  className,
}: TabsProps<TValue>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectTabAt(index: number) {
    const tab = tabs[index];

    if (!tab || tab.disabled) {
      return;
    }

    onValueChange(tab.id);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectTabAt(nextEnabledIndex(tabs, currentIndex, 1));
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectTabAt(nextEnabledIndex(tabs, currentIndex, -1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      selectTabAt(firstEnabledIndex(tabs));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      selectTabAt(lastEnabledIndex(tabs));
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx('inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-0.5', className)}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === value;

        return (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={tab.disabled}
            onClick={() => onValueChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
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
