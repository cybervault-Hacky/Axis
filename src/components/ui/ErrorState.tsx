import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { classNames } from "../../lib/classNames";

interface ErrorStateProps {
  title: string;
  description: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title,
  description,
  primaryAction,
  secondaryAction,
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={classNames("error-state", compact && "error-state--compact", className)}
      role="alert"
    >
      <span className="error-state__icon" aria-hidden="true">
        <CircleAlert size={20} />
      </span>
      <div className="error-state__copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="error-state__actions">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
