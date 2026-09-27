import { useId } from "react";

interface AxisMarkProps {
  className?: string;
  size?: number;
  decorative?: boolean;
}

export function AxisMark({ className, size = 24, decorative = true }: AxisMarkProps) {
  const titleId = useId();

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
      role={decorative ? undefined : "img"}
    >
      {!decorative && <title id={titleId}>AXIS</title>}
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        d="M9.15 22.35 14.9 9.7c.42-.93 1.74-.93 2.16 0l5.78 12.65"
        stroke="var(--axis-mark-ink, #0b0c0e)"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.75 17.1h8.5"
        stroke="var(--axis-mark-ink, #0b0c0e)"
        strokeWidth="2.35"
        strokeLinecap="round"
      />
    </svg>
  );
}
