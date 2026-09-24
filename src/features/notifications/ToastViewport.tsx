import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import type { Notification, NotificationTone } from "./NotificationProvider";

const toneIcons: Record<NotificationTone, typeof Info> = {
  success: CircleCheck,
  information: Info,
  warning: TriangleAlert,
  error: CircleAlert,
};

interface ToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

function Toast({ notification, onDismiss }: ToastProps) {
  const Icon = toneIcons[notification.tone];

  useEffect(() => {
    if (notification.duration === null) return;
    const timer = window.setTimeout(
      () => onDismiss(notification.id),
      notification.duration,
    );
    return () => window.clearTimeout(timer);
  }, [notification.duration, notification.id, onDismiss]);

  const urgent = notification.tone === "error" || notification.tone === "warning";

  return (
    <div
      className={`toast toast--${notification.tone}`}
      role={urgent ? "alert" : "status"}
      aria-atomic="true"
    >
      <span className="toast__icon" aria-hidden="true">
        <Icon size={17} strokeWidth={1.9} />
      </span>
      <div className="toast__copy">
        <strong>{notification.title}</strong>
        {notification.message && <p>{notification.message}</p>}
      </div>
      <Button
        className="toast__dismiss"
        variant="quiet"
        size="icon"
        onClick={() => onDismiss(notification.id)}
        aria-label={`Dismiss ${notification.title}`}
      >
        <X size={14} />
      </Button>
    </div>
  );
}

interface ToastViewportProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

export function ToastViewport({ notifications, onDismiss }: ToastViewportProps) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="toast-viewport" aria-label="Notifications">
      {notifications.map((notification) => (
        <Toast key={notification.id} notification={notification} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}
