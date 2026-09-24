import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { useNativeDialog } from "../overlays/useNativeDialog";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeOnBackdrop = true,
}: DialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useNativeDialog<HTMLDialogElement>({
    open,
    initialFocusRef: closeButtonRef,
  });
  const titleId = useId();
  const descriptionId = useId();

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog__surface">
        <div className="dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <Button
            ref={closeButtonRef}
            data-dialog-initial-focus
            variant="quiet"
            size="icon"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={17} />
          </Button>
        </div>
        {children && <div className="dialog__content">{children}</div>}
        {footer && <div className="dialog__footer">{footer}</div>}
      </div>
    </dialog>
  );
}
