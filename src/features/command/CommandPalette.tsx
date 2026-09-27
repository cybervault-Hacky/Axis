import { ArrowDown, ArrowUp, Check, CornerDownLeft, Search, X } from "lucide-react";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Button } from "../../components/ui/Button";
import { useNativeDialog } from "../../components/overlays/useNativeDialog";
import { commandActions, filterCommandActions, type CommandAction } from "./commandActions";

interface CommandPaletteProps {
  currentPath: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onRequestCommand: () => void;
}

export function CommandPalette({
  currentPath,
  onClose,
  onNavigate,
  onRequestCommand,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useNativeDialog<HTMLDialogElement>({ open: true, initialFocusRef: inputRef });
  const listboxId = useId();
  const titleId = useId();

  const filteredActions = useMemo(
    () => filterCommandActions(commandActions, query),
    [query],
  );
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(filteredActions.length - 1, 0));
  const selectedAction = filteredActions[safeSelectedIndex];

  const executeAction = (action: CommandAction | undefined) => {
    if (!action) return;
    if (action.type === "command") {
      onRequestCommand();
      return;
    }
    if (action.path) onNavigate(action.path);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredActions.length === 0 ? 0 : (current + 1) % filteredActions.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredActions.length === 0
          ? 0
          : (current - 1 + filteredActions.length) % filteredActions.length,
      );
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setSelectedIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setSelectedIndex(Math.max(filteredActions.length - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      executeAction(selectedAction);
    }
  };

  const onBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="command-palette"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onBackdropClick}
    >
      <div className="command-palette__surface">
        <h2 id={titleId} className="sr-only">Search AXIS</h2>
        <div className="command-palette__search">
          <Search size={18} strokeWidth={1.8} aria-hidden="true" />
          <input
            ref={inputRef}
            data-dialog-initial-focus
            type="search"
            role="combobox"
            aria-label="Search commands and navigation"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={selectedAction ? `${listboxId}-${selectedAction.id}` : undefined}
            placeholder="Search AXIS"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          {query ? (
            <Button variant="quiet" size="icon" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={15} />
            </Button>
          ) : (
            <kbd>Esc</kbd>
          )}
        </div>

        <div className="command-palette__body">
          <div className="command-palette__section-label">
            <span>{query ? "Results" : "Quick actions"}</span>
            <span>{filteredActions.length}</span>
          </div>
          {filteredActions.length > 0 ? (
            <div id={listboxId} className="command-palette__results" role="listbox">
              {filteredActions.map((action, index) => {
                const active = index === safeSelectedIndex;
                const isCurrent = action.type === "navigation" && action.path === currentPath;
                return (
                  <button
                    key={action.id}
                    id={`${listboxId}-${action.id}`}
                    className="command-palette__result"
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-active={active || undefined}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => executeAction(action)}
                  >
                    <span className="command-palette__result-icon" aria-hidden="true">
                      <action.icon size={17} strokeWidth={1.8} />
                    </span>
                    <span className="command-palette__result-copy">
                      <strong>{action.label}</strong>
                      <small>{action.description}</small>
                    </span>
                    {isCurrent ? (
                      <span className="command-palette__current">
                        <Check size={13} aria-hidden="true" />Current
                      </span>
                    ) : active ? (
                      <CornerDownLeft className="command-palette__enter" size={14} aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="command-palette__empty">
              <Search size={20} aria-hidden="true" />
              <strong>No matching actions</strong>
              <span>Try a page name such as Projects or Settings.</span>
            </div>
          )}
        </div>

        <div className="command-palette__footer" aria-hidden="true">
          <span><kbd><ArrowUp size={11} /><ArrowDown size={11} /></kbd>Move</span>
          <span><kbd><CornerDownLeft size={11} /></kbd>Open</span>
          <span><kbd>Esc</kbd>Close</span>
        </div>
      </div>
    </dialog>
  );
}
