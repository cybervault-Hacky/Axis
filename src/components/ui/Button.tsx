import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { classNames } from "../../lib/classNames";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "small" | "medium" | "large" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "secondary",
    size = "medium",
    leadingIcon,
    trailingIcon,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classNames("button", `button--${variant}`, `button--${size}`, className)}
      {...props}
    >
      {leadingIcon && <span className="button__icon">{leadingIcon}</span>}
      {children && <span className="button__label">{children}</span>}
      {trailingIcon && <span className="button__icon">{trailingIcon}</span>}
    </button>
  );
});
