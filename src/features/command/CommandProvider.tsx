import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { APP_SHORTCUTS, matchesShortcut } from "../../app/shortcuts";
import { CommandPalette } from "./CommandPalette";

interface CommandContextValue {
  draft: string;
  setDraft: (draft: string) => void;
  clearDraft: () => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  requestCommandFocus: () => void;
  focusRequest: number;
}

const CommandContext = createContext<CommandContextValue | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [draft, setDraft] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const clearDraft = useCallback(() => setDraft(""), []);

  const requestCommandFocus = useCallback(() => {
    setPaletteOpen(false);
    if (location.pathname !== "/") void navigate("/");
    setFocusRequest((current) => current + 1);
  }, [location.pathname, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, APP_SHORTCUTS.commandPalette)) return;
      event.preventDefault();
      setPaletteOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(
    () => ({
      draft,
      setDraft,
      clearDraft,
      paletteOpen,
      openPalette,
      closePalette,
      requestCommandFocus,
      focusRequest,
    }),
    [clearDraft, closePalette, draft, focusRequest, openPalette, paletteOpen, requestCommandFocus],
  );

  return (
    <CommandContext.Provider value={value}>
      {children}
      {paletteOpen && (
        <CommandPalette
          currentPath={location.pathname}
          onClose={closePalette}
          onNavigate={(path) => {
            void navigate(path);
            closePalette();
          }}
          onRequestCommand={requestCommandFocus}
        />
      )}
    </CommandContext.Provider>
  );
}

// The hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useCommand(): CommandContextValue {
  const context = useContext(CommandContext);
  if (!context) throw new Error("useCommand must be used within CommandProvider");
  return context;
}
