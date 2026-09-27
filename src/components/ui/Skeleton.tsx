import type { CSSProperties } from "react";
import { classNames } from "../../lib/classNames";

interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  rounded?: boolean;
  className?: string;
}

export function Skeleton({ width = "100%", height = 12, rounded = false, className }: SkeletonProps) {
  return (
    <span
      className={classNames("skeleton", rounded && "skeleton--rounded", className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
