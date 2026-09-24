import { classNames } from "../../lib/classNames";

interface SpinnerProps {
  size?: "small" | "medium";
  label?: string;
  className?: string;
}

export function Spinner({ size = "small", label = "Loading", className }: SpinnerProps) {
  return (
    <span
      className={classNames("spinner", `spinner--${size}`, className)}
      role="status"
      aria-label={label}
    />
  );
}
