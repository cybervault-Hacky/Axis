import { useEffect, useRef, type RefObject } from "react";

interface UseNativeDialogOptions {
  open: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useNativeDialog<T extends HTMLDialogElement>({
  open,
  initialFocusRef,
}: UseNativeDialogOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();

      window.requestAnimationFrame(() => {
        const initialTarget =
          initialFocusRef?.current ??
          dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]");
        initialTarget?.focus();
      });
      return;
    }

    if (!open && dialog.open) {
      dialog.close();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    }
  }, [initialFocusRef, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true",
      );

      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      if (!firstElement || !lastElement) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    dialog.addEventListener("keydown", trapFocus);
    return () => dialog.removeEventListener("keydown", trapFocus);
  }, [open]);

  useEffect(
    () => () => {
      const dialog = dialogRef.current;
      if (dialog?.open) dialog.close();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    },
    [],
  );

  return dialogRef;
}
