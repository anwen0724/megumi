// Renders command suggestions supplied by a trusted catalog; this component does not own command discovery.
import { Package, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandSuggestionItem, CommandSuggestionResult } from '@megumi/product/host-interface';

interface CommandSuggestionPanelProps {
  suggestions: CommandSuggestionResult;
  selectedIndex: number;
  onChoose: (command: CommandSuggestionItem) => void;
  className?: string;
}

export function CommandSuggestionPanel({
  suggestions,
  selectedIndex,
  onChoose,
  className,
}: CommandSuggestionPanelProps) {
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
      data-testid="command-suggestion-panel"
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
          {group.items.map((command) => {
            const currentIndex = itemIndex;
            itemIndex += 1;
            const selected = currentIndex === selectedIndex;
            const primary = getSuggestionPrimaryLabel(command);
            const secondary = command.display?.secondary ?? command.description;
            const badge = command.display?.badge ?? command.source_badge;

            return (
              <button
                key={suggestionKey(group.id, command)}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={`${primary} ${secondary}${badge ? ` ${badge}` : ''}`}
                className={[
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[var(--color-text)]',
                  'hover:bg-[var(--color-accent-soft)]',
                  selected
                    ? 'aria-selected:bg-[var(--color-accent-soft)] aria-selected:shadow-[inset_3px_0_0_var(--color-accent)]'
                    : '',
                ].join(' ')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChoose(command)}
              >
                <span
                  data-testid={`command-suggestion-icon-${command.source.kind === 'skill' ? 'skill' : 'command'}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-text-muted)]"
                  aria-hidden="true"
                >
                  {command.source.kind === 'skill'
                    ? <Package size={14} />
                    : <Terminal size={14} />}
                </span>
                <span className="shrink-0 font-mono text-[var(--color-text)]">
                  <CommandName item={command} primary={primary} />
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

function CommandName({ item, primary }: { item: CommandSuggestionItem; primary: string }) {
  const displayName = primary;
  if (item.match.field !== 'name') {
    return <>{displayName}</>;
  }

  const prefixLength = item.source.kind === 'skill'
    ? 0
    : item.match.prefix.length + 1;

  return (
    <>
      <span className="text-[var(--color-accent)]">{displayName.slice(0, prefixLength)}</span>
      {displayName.slice(prefixLength)}
    </>
  );
}

function getSuggestionPrimaryLabel(item: CommandSuggestionItem): string {
  const rawName = item.display?.primary ?? item.name;
  if (item.source.kind !== 'skill') {
    return `/${rawName}`;
  }

  return humanizeCommandName(rawName);
}

function humanizeCommandName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function suggestionKey(groupId: string, command: CommandSuggestionItem): string {
  const sourceIdentity = command.source.kind === 'skill'
    ? command.source.skillPath
    : command.name;
  return `${groupId}:${command.source.kind}:${sourceIdentity}:${command.match.field}:${command.match.value}`;
}
