import { useId, type ReactNode } from "react";
import { classNames } from "../../lib/classNames";

interface TooltipProps {
  label: string;
  children: ReactNode;
  placement?: "top" | "right" | "bottom";
  disabled?: boolean;
  className?: string;
}

export function Tooltip({
  label,
  children,
  placement = "top",
  disabled = false,
  className,
}: TooltipProps) {
  const tooltipId = useId();

  return (
    <span
      className={classNames(
        "tooltip",
        `tooltip--${placement}`,
        disabled && "tooltip--disabled",
        className,
      )}
      aria-describedby={disabled ? undefined : tooltipId}
    >
      {children}
      <span id={tooltipId} className="tooltip__content" role="tooltip">
        {label}
      </span>
    </span>
  );
}
