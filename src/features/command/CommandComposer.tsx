import { ArrowRight, CornerDownLeft, LockKeyhole, X } from "lucide-react";
import {
  forwardRef,
  useId,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { classNames } from "../../lib/classNames";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";

export type CommandComposerStatus = "idle" | "busy" | "unavailable";

interface CommandComposerProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onSubmit"> {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onUnavailableAttempt?: () => void;
  status?: CommandComposerStatus;
  action?: ReactNode;
}

export const CommandComposer = forwardRef<HTMLTextAreaElement, CommandComposerProps>(
  function CommandComposer(
    {
      value,
      onValueChange,
      onSubmit,
      onUnavailableAttempt,
      status = "idle",
      action,
      className,
      placeholder = "Tell AXIS what you need...",
      ...props
    },
    ref,
  ) {
    const descriptionId = useId();
    const hasValue = value.trim().length > 0;
    const busy = status === "busy";
    const unavailable = status === "unavailable";

    const attemptSubmit = () => {
      if (!hasValue || busy) return;
      if (unavailable) {
        onUnavailableAttempt?.();
        return;
      }
      onSubmit?.(value.trim());
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        attemptSubmit();
      }
    };

    return (
      <section
        className={classNames("global-command", className)}
        aria-label="AXIS command workspace"
        aria-busy={busy}
      >
        <div className="global-command__header">
          <div className="global-command__identity">
            <span className="global-command__mark" aria-hidden="true">
              <CornerDownLeft size={17} strokeWidth={1.8} />
            </span>
            <span>
              <strong>Command workspace</strong>
              <small>Describe an outcome in your own words</small>
            </span>
          </div>
          <Badge tone="warning">Provider required</Badge>
        </div>

        <div className="global-command__input-wrap">
          <label htmlFor={`${descriptionId}-input`} className="sr-only">
            Tell AXIS what you need
          </label>
          <textarea
            ref={ref}
            id={`${descriptionId}-input`}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={4}
            maxLength={4000}
            aria-describedby={descriptionId}
            disabled={busy}
            {...props}
          />
          {hasValue && !busy && (
            <Button
              className="global-command__clear"
              variant="quiet"
              size="icon"
              onClick={() => onValueChange("")}
              aria-label="Clear command draft"
            >
              <X size={15} />
            </Button>
          )}
        </div>

        <div className="global-command__footer">
          <p id={descriptionId} className="global-command__privacy">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Your draft stays in this session and is not submitted.</span>
          </p>
          <div className="global-command__actions">
            <span className="global-command__key-hint"><kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</span>
            {action}
            <Button
              variant="primary"
              size="medium"
              trailingIcon={busy ? <Spinner label="Preparing command" /> : <ArrowRight size={15} />}
              disabled={!hasValue || busy || unavailable}
              onClick={attemptSubmit}
            >
              {busy ? "Preparing" : unavailable ? "Unavailable" : "Continue"}
            </Button>
          </div>
        </div>
      </section>
    );
  },
);
