import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getStoredSidebarPreference,
  SIDEBAR_STORAGE_KEY,
  type SidebarPreference,
} from "./uiPreferences";

interface UIPreferencesContextValue {
  sidebarPreference: SidebarPreference;
  sidebarCollapsed: boolean;
  compactViewport: boolean;
  setSidebarPreference: (preference: SidebarPreference) => void;
  toggleSidebar: () => void;
}

const UIPreferencesContext = createContext<UIPreferencesContextValue | null>(null);
const compactViewportQuery = "(max-width: 1080px)";

function getInitialSidebarPreference(): SidebarPreference {
  if (typeof window === "undefined") return "expanded";
  return getStoredSidebarPreference(window.localStorage);
}

function getInitialCompactViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(compactViewportQuery).matches;
}

export function UIPreferencesProvider({ children }: { children: ReactNode }) {
  const [sidebarPreference, setSidebarPreferenceState] =
    useState<SidebarPreference>(getInitialSidebarPreference);
  const [compactViewport, setCompactViewport] = useState(getInitialCompactViewport);

  useEffect(() => {
    const mediaQuery = window.matchMedia(compactViewportQuery);
    const onViewportChange = (event: MediaQueryListEvent) => setCompactViewport(event.matches);
    mediaQuery.addEventListener("change", onViewportChange);
    return () => mediaQuery.removeEventListener("change", onViewportChange);
  }, []);

  const setSidebarPreference = useCallback((preference: SidebarPreference) => {
    setSidebarPreferenceState(preference);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, preference);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarPreferenceState((current) => {
      const nextPreference = current === "expanded" ? "collapsed" : "expanded";
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, nextPreference);
      return nextPreference;
    });
  }, []);

  const value = useMemo(
    () => ({
      sidebarPreference,
      sidebarCollapsed: compactViewport || sidebarPreference === "collapsed",
      compactViewport,
      setSidebarPreference,
      toggleSidebar,
    }),
    [compactViewport, setSidebarPreference, sidebarPreference, toggleSidebar],
  );

  return (
    <UIPreferencesContext.Provider value={value}>
      {children}
    </UIPreferencesContext.Provider>
  );
}

// The hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useUIPreferences(): UIPreferencesContextValue {
  const context = useContext(UIPreferencesContext);
  if (!context) {
    throw new Error("useUIPreferences must be used within UIPreferencesProvider");
  }
  return context;
}
