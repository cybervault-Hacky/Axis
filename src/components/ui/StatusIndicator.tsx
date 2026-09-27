import { classNames } from "../../lib/classNames";

interface StatusIndicatorProps {
  label: string;
  detail?: string;
  tone?: "ready" | "idle" | "pending" | "unavailable";
  compact?: boolean;
  className?: string;
}

export function StatusIndicator({
  label,
  detail,
  tone = "idle",
  compact = false,
  className,
}: StatusIndicatorProps) {
  return (
    <span
      className={classNames(
        "status-indicator",
        `status-indicator--${tone}`,
        compact && "status-indicator--compact",
        className,
      )}
    >
      <span className="status-indicator__dot" aria-hidden="true" />
      <span className="status-indicator__text">
        <span className="status-indicator__label">{label}</span>
        {detail && <span className="status-indicator__detail">{detail}</span>}
      </span>
    </span>
  );
}
