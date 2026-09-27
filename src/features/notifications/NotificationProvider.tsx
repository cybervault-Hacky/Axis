import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastViewport } from "./ToastViewport";

export type NotificationTone = "success" | "information" | "warning" | "error";

export interface NotificationInput {
  title: string;
  message?: string;
  tone?: NotificationTone;
  duration?: number | null;
}

export interface Notification extends Required<Pick<NotificationInput, "title" | "tone">> {
  id: string;
  message?: string;
  duration: number | null;
}

interface NotificationContextValue {
  notifications: Notification[];
  notify: (notification: NotificationInput) => string;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);
const defaultDuration = 4200;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  const notify = useCallback((input: NotificationInput) => {
    nextId.current += 1;
    const id = `axis-notification-${nextId.current}`;
    const notification: Notification = {
      id,
      title: input.title,
      message: input.message,
      tone: input.tone ?? "information",
      duration: input.duration === undefined ? defaultDuration : input.duration,
    };

    setNotifications((current) => [...current.slice(-3), notification]);
    return id;
  }, []);

  const value = useMemo(
    () => ({ notifications, notify, dismiss }),
    [dismiss, notifications, notify],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastViewport notifications={notifications} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

// The hook intentionally shares this module with its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
