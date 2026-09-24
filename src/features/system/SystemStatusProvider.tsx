import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SystemState = "ready" | "starting" | "unavailable" | "attention";

interface SystemStatusDefinition {
  label: string;
  detail: string;
  tone: "ready" | "idle" | "pending" | "unavailable";
}

const systemDefinitions: Record<SystemState, SystemStatusDefinition> = {
  ready: {
    label: "Ready",
    detail: "Local interface ready",
    tone: "ready",
  },
  starting: {
    label: "Starting",
    detail: "Preparing the local interface",
    tone: "pending",
  },
  unavailable: {
    label: "Unavailable",
    detail: "Local interface unavailable",
    tone: "unavailable",
  },
  attention: {
    label: "Attention required",
    detail: "Review the application state",
    tone: "pending",
  },
};

interface SystemStatusContextValue extends SystemStatusDefinition {
  state: SystemState;
  setState: (state: SystemState) => void;
}

const SystemStatusContext = createContext<SystemStatusContextValue | null>(null);

export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SystemState>("ready");
  const value = useMemo(
    () => ({ state, setState, ...systemDefinitions[state] }),
    [state],
  );

  return (
    <SystemStatusContext.Provider value={value}>
      {children}
    </SystemStatusContext.Provider>
  );
}

// The hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useSystemStatus(): SystemStatusContextValue {
  const context = useContext(SystemStatusContext);
  if (!context) throw new Error("useSystemStatus must be used within SystemStatusProvider");
  return context;
}
