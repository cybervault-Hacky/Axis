import type { HTMLAttributes } from "react";
import { classNames } from "../../lib/classNames";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "subtle" | "raised";
}

export function Card({ className, tone = "default", ...props }: CardProps) {
  return <div className={classNames("card", `card--${tone}`, className)} {...props} />;
}
