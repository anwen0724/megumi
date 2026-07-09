// Renders command suggestions supplied by a trusted catalog; this component does not own command discovery.
import type { CommandSuggestionItem, CommandSuggestionResult } from '@megumi/coding-agent/commands';

interface CommandSuggestionPanelProps {
  suggestions: CommandSuggestionResult;
  selectedIndex: number;
  onChoose: (command: CommandSuggestionItem) => void;
}

export function CommandSuggestionPanel({
  suggestions,
  selectedIndex,
  onChoose,
}: CommandSuggestionPanelProps) {
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
      aria-label="Command suggestions"
      className="mb-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-[var(--shadow-soft)]"
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
            const secondary = command.display?.secondary ?? command.description;
            const badge = command.display?.badge ?? command.source_badge;

            return (
              <button
                key={`${group.id}:${command.name}:${command.match.field}:${command.match.value}`}
                type="button"
                role="option"
                aria-selected={currentIndex === selectedIndex}
                aria-label={`/${command.display?.primary ?? command.name} ${secondary}${badge ? ` ${badge}` : ''}`}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] aria-selected:bg-[var(--color-surface-hover)]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChoose(command)}
              >
                <span className="shrink-0 font-mono text-[var(--color-text)]">
                  <CommandName item={command} />
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

function CommandName({ item }: { item: CommandSuggestionItem }) {
  const displayName = item.display?.primary ?? item.name;
  if (item.match.field !== 'name') {
    return <>{`/${displayName}`}</>;
  }

  const prefixLength = item.match.prefix.length;

  return (
    <>
      /
      <span className="text-[var(--color-accent)]">{displayName.slice(0, prefixLength)}</span>
      {displayName.slice(prefixLength)}
    </>
  );
}
