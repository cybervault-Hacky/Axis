import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

/**
 * Shared "is this IPC call really from our own app window" check.
 *
 * Extracted out of `aiController.ts` in Phase 5 so the new conversations
 * controller can reuse the exact same security-critical logic instead of
 * re-implementing (and risking subtly diverging from) it. Behaviour is
 * unchanged from the original private helper: the call must come from the
 * current main window's own top-level frame, never a webview/iframe or a
 * stale/destroyed window reference.
 */
export function createTrustedSenderCheck(getMainWindow: () => BrowserWindow | null) {
  return function isTrustedSender(event: IpcMainInvokeEvent): boolean {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;
    if (event.sender !== win.webContents) return false;
    const mainFrame = win.webContents.mainFrame;
    if (!mainFrame || event.senderFrame !== mainFrame) return false;
    return true;
  };
}
