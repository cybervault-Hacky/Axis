import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ open, onClose, title, description, children, footer }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="axis-dialog-title"
      aria-describedby={description ? "axis-dialog-description" : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog__surface">
        <div className="dialog__header">
          <div>
            <h2 id="axis-dialog-title">{title}</h2>
            {description && <p id="axis-dialog-description">{description}</p>}
          </div>
          <Button variant="quiet" size="icon" onClick={onClose} aria-label="Close dialog">
            <X size={17} />
          </Button>
        </div>
        {children && <div className="dialog__content">{children}</div>}
        {footer && <div className="dialog__footer">{footer}</div>}
      </div>
    </dialog>
  );
}
