import { h } from "../dom";
import { icons } from "../icons";

export interface ComposerOptions {
  idPrefix: string;
  placeholder?: string;
  large?: boolean;
  onSubmitAttempt: (value: string) => void;
  /** Called when the user activates the cancel control while a request is active. */
  onCancelRequest?: () => void;
}

export interface ComposerHandle {
  element: HTMLElement;
  setValue: (value: string) => void;
  focusEnd: () => void;
  /** Toggles the loading/active-request state: disables Send and reveals Cancel. */
  setBusy: (busy: boolean) => void;
}

const DEFAULT_PLACEHOLDER =
  "Ask AXIS anything — describe a task, paste text to summarize, or outline what you need help with...";

/**
 * The natural-language composer used on Home and AI Workspace. Pure UI: it
 * never contacts a network or simulates a response — submit attempts and
 * cancel requests are reported back to the caller, which owns the real
 * request lifecycle and is responsible for showing an honest status.
 */
export function createComposer(options: ComposerOptions): ComposerHandle {
  const textareaId = `${options.idPrefix}-textarea`;
  let busy = false;

  const textarea = h("textarea", {
    id: textareaId,
    className: "axis-composer__textarea",
    placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER,
    rows: options.large ? 8 : 5,
    "aria-label": "Message AXIS"
  }) as HTMLTextAreaElement;

  const clearButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--ghost", id: `${options.idPrefix}-clear` },
    [h("span", { className: "axis-icon" }, [icons.clear()]), "Clear"]
  ) as HTMLButtonElement;

  const sendButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--primary", id: `${options.idPrefix}-send`, disabled: true },
    [h("span", { className: "axis-icon" }, [icons.send()]), "Send"]
  ) as HTMLButtonElement;

  const cancelButton = h(
    "button",
    {
      type: "button",
      className: "axis-btn axis-btn--ghost",
      id: `${options.idPrefix}-cancel`,
      hidden: true,
      "aria-label": "Cancel request"
    },
    [h("span", { className: "axis-icon" }, [icons.close()]), "Cancel"]
  ) as HTMLButtonElement;

  function syncButtons(): void {
    const hasText = textarea.value.trim().length > 0;
    sendButton.disabled = busy || !hasText;
    clearButton.disabled = busy || !hasText;
  }

  function attemptSubmit(): void {
    if (busy) return;
    const value = textarea.value.trim();
    if (!value) return;
    options.onSubmitAttempt(value);
  }

  textarea.addEventListener("input", syncButtons);

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (textarea.value.length > 0) {
        event.stopPropagation();
        textarea.value = "";
        syncButtons();
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      // Plain Enter submits; Shift+Enter inserts a newline (default behaviour).
      event.preventDefault();
      attemptSubmit();
    }
  });

  clearButton.addEventListener("click", () => {
    if (busy) return;
    textarea.value = "";
    syncButtons();
    textarea.focus();
  });

  sendButton.addEventListener("click", () => attemptSubmit());
  cancelButton.addEventListener("click", () => options.onCancelRequest?.());

  const footer = h("div", { className: "axis-composer__footer" }, [
    h("span", { className: "axis-composer__hint" }, [
      h("kbd", {}, ["Enter"]),
      " to send  ·  ",
      h("kbd", {}, ["Shift"]),
      " + ",
      h("kbd", {}, ["Enter"]),
      " for a new line  ·  ",
      h("kbd", {}, ["Esc"]),
      " to clear"
    ]),
    h("div", { className: "axis-composer__actions" }, [clearButton, cancelButton, sendButton])
  ]);

  const element = h("div", { className: "axis-composer" }, [textarea, footer]);

  return {
    element,
    setValue(value: string) {
      textarea.value = value;
      syncButtons();
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
    },
    focusEnd() {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    },
    setBusy(nextBusy: boolean) {
      busy = nextBusy;
      cancelButton.hidden = !busy;
      syncButtons();
    }
  };
}
