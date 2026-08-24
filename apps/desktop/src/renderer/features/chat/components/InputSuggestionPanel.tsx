// Renders `/` input suggestions supplied by Product; this component does not own discovery.
import { Package, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { InputSuggestionQueryItem, InputSuggestionQueryResult } from '@megumi/product-host/host';

interface InputSuggestionPanelProps {
  suggestions: InputSuggestionQueryResult;
  selectedIndex: number;
  onChoose: (item: InputSuggestionQueryItem) => void;
  /** Mouse hover moves the single keyboard selection so both inputs share one highlight. */
  onHoverIndexChange?: (index: number) => void;
  className?: string;
}

export function InputSuggestionPanel({
  suggestions,
  selectedIndex,
  onChoose,
  onHoverIndexChange,
  className,
}: InputSuggestionPanelProps) {
  const { t } = useTranslation('chat');
  if (suggestions.type === 'inactive') {
    return null;
  }

  const visibleItems = suggestions.groups.flatMap((group) => group.items);

  if (visibleItems.length === 0) {
    return null;
  }

  let itemIndex = 0;

  return (
    <div
      data-testid="input-suggestion-panel"
      role="listbox"
      aria-label={t('commands.suggestions')}
      className={[
        'mb-2 overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]',
        className,
      ].filter(Boolean).join(' ')}
    >
      {suggestions.groups.map((group) => (
        <div key={group.id}>
          {group.items.length > 0 ? (
            <div className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-[var(--color-text-subtle)]">
              {group.label}
            </div>
          ) : null}
          {group.items.map((item) => {
            const currentIndex = itemIndex;
            itemIndex += 1;
            const selected = currentIndex === selectedIndex;
            const primary = getSuggestionPrimaryLabel(item);
            const secondary = item.description;
            const badge = item.kind === 'skill' ? item.sourceLabel : undefined;

            return (
              <button
                key={suggestionKey(group.id, item)}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={`${primary} ${secondary}${badge ? ` ${badge}` : ''}`}
                className={[
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[var(--color-text)]',
                  selected
                    ? 'aria-selected:bg-[var(--color-accent-soft)] aria-selected:shadow-[inset_3px_0_0_var(--color-accent)]'
                    : '',
                ].join(' ')}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHoverIndexChange?.(currentIndex)}
                onClick={() => onChoose(item)}
              >
                <span
                  data-testid={`input-suggestion-icon-${item.kind}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-muted)]"
                  aria-hidden="true"
                >
                  {item.kind === 'skill'
                    ? <Package size={14} />
                    : <Terminal size={14} />}
                </span>
                <span className="shrink-0 font-mono text-[var(--color-text)]">
                  <SuggestionName item={item} primary={primary} />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-muted)]">
                  {secondary}
                </span>
                {badge ? (
                  <span className="shrink-0 text-xs text-[var(--color-text-subtle)]">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SuggestionName({ item, primary }: { item: InputSuggestionQueryItem; primary: string }) {
  const displayName = primary;
  if (item.kind === 'skill' || item.match.field !== 'name') {
    return <>{displayName}</>;
  }
  const prefixLength = item.match.prefix.length + 1;
  return (
    <>
      <span className="text-[var(--color-accent)]">{displayName.slice(0, prefixLength)}</span>
      {displayName.slice(prefixLength)}
    </>
  );
}

function getSuggestionPrimaryLabel(item: InputSuggestionQueryItem): string {
  if (item.kind === 'command') {
    return `/${item.name}`;
  }
  return humanizeCommandName(item.name);
}

function humanizeCommandName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function suggestionKey(groupId: string, item: InputSuggestionQueryItem): string {
  const sourceIdentity = item.kind === 'skill' ? item.selection.skillPath : item.name;
  return `${groupId}:${item.kind}:${sourceIdentity}:${item.match.field}:${item.match.value}`;
}
