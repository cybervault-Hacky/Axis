import { AI_ERROR_MESSAGES, AI_PROVIDER_LABELS } from "../../../shared/ai-contract";
import type { ComposerHandle } from "../components/composer";
import type { ResponseHandle } from "../components/responseArea";
import type { AxisStore } from "../state";
import { buildSendPayload, cancelPrompt, sendPrompt } from "./aiClient";

export interface AiLifecycleHandle {
  /** Wire this as the composer's onSubmitAttempt. */
  submit: (value: string) => void;
  /** Wire this as the composer's onCancelRequest. */
  cancel: () => void;
}

/**
 * The real composer -> provider request lifecycle, shared by Home and AI
 * Workspace so the behaviour (loading, cancellation, honest errors, stale
 * response guarding) is defined exactly once.
 *
 * `getComposer` is a getter rather than a direct reference so the composer
 * itself can be constructed with these handlers as callbacks before it
 * exists yet (the composer is created with `onSubmitAttempt: lifecycle.submit`
 * and only assigned to the variable `getComposer` closes over afterwards).
 */
export function createAiLifecycle(store: AxisStore, getComposer: () => ComposerHandle, response: ResponseHandle): AiLifecycleHandle {
  let activeRequestId: string | null = null;

  function submit(value: string): void {
    // Defence in depth: the composer already disables Send while busy, and
    // the main process independently rejects concurrent requests.
    if (activeRequestId) return;

    const provider = store.getState().settings.aiProvider;
    const providerLabel = AI_PROVIDER_LABELS[provider];
    const status = store.getState().aiStatus;
    if (!status.nativeBridgeAvailable) {
      response.showError(
        `This preview window has no AI engine connected — run the AXIS desktop app to send a message to ${providerLabel}. ` +
          "Your draft is unchanged."
      );
      return;
    }
    if (!status.configured) {
      response.showError(`Add a ${providerLabel} API key in Settings to send a message. Your draft is unchanged.`);
      return;
    }

    const payload = buildSendPayload(value, { timeoutMs: store.getState().settings.aiRequestTimeoutMs, provider });
    if (!payload) {
      response.showError(AI_ERROR_MESSAGES.VALIDATION_ERROR);
      return;
    }

    activeRequestId = payload.requestId;
    getComposer().setBusy(true);
    response.showLoading();

    void sendPrompt(payload).then((result) => {
      // A cancelled or superseded request must never overwrite newer state.
      if (activeRequestId !== payload.requestId) return;
      activeRequestId = null;
      getComposer().setBusy(false);

      if (result.ok) {
        response.showSuccess(result.text, result.truncated);
      } else {
        response.showError(result.message);
      }
    });
  }

  function cancel(): void {
    if (!activeRequestId) return;
    const id = activeRequestId;
    activeRequestId = null;
    void cancelPrompt(id);
    getComposer().setBusy(false);
    response.showError(AI_ERROR_MESSAGES.CANCELLED);
  }

  return { submit, cancel };
}
