import type { HTMLAttributes } from "react";
import { classNames } from "../../lib/classNames";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "accent" | "positive" | "warning";
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return <span className={classNames("badge", `badge--${tone}`, className)} {...props} />;
}
