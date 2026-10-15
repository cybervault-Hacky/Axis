import { h } from "../dom";

export interface ResponseHandle {
  element: HTMLElement;
  showLoading: () => void;
  showSuccess: (text: string, truncated: boolean) => void;
  showError: (message: string) => void;
  reset: () => void;
}

/**
 * Shows the outcome of the single most recent AI request for a composer:
 * loading, success (with a visible "may be incomplete" note when the
 * provider truncated its answer), or a normalized error. Hidden entirely
 * until the first request. Model text is always set via `textContent`
 * (through the `h()` helper's text-node children) — never parsed as HTML.
 */
export function createResponseArea(idPrefix: string): ResponseHandle {
  const indicator = h("span", { className: "axis-response__indicator" });
  const title = h("p", { className: "axis-response__title", id: `${idPrefix}-response-title` }, []);
  const note = h("p", { className: "axis-response__note", id: `${idPrefix}-response-note`, hidden: true }, []);
  const text = h("p", { className: "axis-response__text", id: `${idPrefix}-response-detail` }, []);
  const body = h("div", { className: "axis-response__body" }, [title, note, text]);
  const element = h(
    "div",
    { className: "axis-response", role: "status", "aria-live": "polite", id: `${idPrefix}-response`, hidden: true },
    [indicator, body]
  );

  function setVariant(variant: "loading" | "success" | "error"): void {
    element.classList.remove("axis-response--loading", "axis-response--success", "axis-response--error");
    element.classList.add(`axis-response--${variant}`);
  }

  return {
    element,
    showLoading() {
      element.hidden = false;
      setVariant("loading");
      title.textContent = "Sending to Gemini…";
      note.hidden = true;
      note.textContent = "";
      text.textContent = "";
    },
    showSuccess(value: string, truncated: boolean) {
      element.hidden = false;
      setVariant("success");
      title.textContent = "Response";
      if (truncated) {
        note.hidden = false;
        note.textContent = "This response may be incomplete — the provider cut it short.";
      } else {
        note.hidden = true;
        note.textContent = "";
      }
      text.textContent = value;
    },
    showError(message: string) {
      element.hidden = false;
      setVariant("error");
      title.textContent = "Message not sent";
      note.hidden = true;
      note.textContent = "";
      text.textContent = message;
    },
    reset() {
      element.hidden = true;
      note.hidden = true;
      note.textContent = "";
      text.textContent = "";
      title.textContent = "";
    }
  };
}
