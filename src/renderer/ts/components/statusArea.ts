import { h } from "../dom";
import { AI_PROVIDER_LABELS, type AiProviderStatus } from "../../../shared/ai-contract";

export interface StatusHandle {
  element: HTMLElement;
  update: (status: AiProviderStatus) => void;
}

/**
 * Reflects the AI engine's *configuration* readiness (not an individual
 * request's outcome — see responseArea.ts for that). Driven entirely by an
 * `AiProviderStatus` so it always shows the real, current state: never
 * configured, configured with an encrypted on-disk key, configured for this
 * session only, or unavailable because this is the browser preview without
 * the native preload bridge.
 */
export function createStatusArea(idPrefix: string): StatusHandle {
  const indicator = h("span", { className: "axis-status__indicator" });
  const title = h("p", { className: "axis-status__title", id: `${idPrefix}-status-title` }, []);
  const detail = h("p", { className: "axis-status__detail", id: `${idPrefix}-status-detail` }, []);
  const body = h("div", { className: "axis-status__body" }, [title, detail]);
  const element = h(
    "div",
    { className: "axis-status", role: "status", "aria-live": "polite", id: `${idPrefix}-status` },
    [indicator, body]
  );

  function update(status: AiProviderStatus): void {
    indicator.classList.remove("axis-status__indicator--attention", "axis-status__indicator--ready");
    const providerLabel = AI_PROVIDER_LABELS[status.provider];

    if (!status.nativeBridgeAvailable) {
      indicator.classList.add("axis-status__indicator--attention");
      title.textContent = "Native AI engine unavailable in this preview";
      detail.textContent =
        `This browser preview has no Electron preload bridge, so it cannot store a key or send a ${providerLabel} request. ` +
        "Run the AXIS desktop app to connect to the real AI engine.";
      return;
    }

    if (!status.configured) {
      indicator.classList.add("axis-status__indicator--attention");
      title.textContent = `${providerLabel} not configured`;
      detail.textContent = `Add your ${providerLabel} API key in Settings to enable AI requests.`;
      return;
    }

    indicator.classList.add("axis-status__indicator--ready");
    if (status.backend === "session") {
      title.textContent = `${providerLabel} ready (session only)`;
      detail.textContent = "Your key is held in memory for this run only and was not saved to disk.";
    } else {
      title.textContent = `${providerLabel} ready`;
      detail.textContent = `Your ${providerLabel} API key is stored encrypted on this device.`;
    }
  }

  return { element, update };
}
