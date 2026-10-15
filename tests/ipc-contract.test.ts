import { describe, expect, it } from "vitest";
import { AXIS_IPC_CHANNELS } from "../src/shared/ipc-contract";

describe("AXIS_IPC_CHANNELS", () => {
  it("exposes only the namespaced, intentionally narrow set of channels", () => {
    const channels = Object.values(AXIS_IPC_CHANNELS);
    // Phase 1: one read-only metadata channel. Phase 3 adds the narrow set
    // of AI-engine/credential channels, Phase 4 adds exactly two more
    // (starting a stream, and the one push-style stream-event channel),
    // Phase 5 adds exactly seven invoke/handle conversation-history
    // channels (list/search/get/save/rename/delete/clear-all), Phase 7
    // adds exactly two more invoke/handle channels (export/import, both
    // still main-process-owned, native-dialog-gated), Phase 11 adds
    // exactly one more ("export all", same native-dialog-gated shape as
    // export), Phase 12 adds exactly one more ("import all", same
    // native-dialog-gated shape as import), and Phase 13 adds exactly one
    // more ("import from text", for drag-and-drop — the one channel whose
    // payload is untrusted file content rather than a dialog-resolved
    // path) — still no filesystem, process, or shell access of any kind
    // exposed directly.
    expect(channels).toHaveLength(21);
    for (const channel of channels) {
      expect(channel.startsWith("axis:")).toBe(true);
    }
  });

  it("includes the expected AI-engine channels, each appearing exactly once", () => {
    const channels = Object.values(AXIS_IPC_CHANNELS);
    const expected = [
      "axis:get-app-info",
      "axis:ai:get-status",
      "axis:ai:import-credential",
      "axis:ai:remove-credential",
      "axis:ai:test-connection",
      "axis:ai:send-request",
      "axis:ai:cancel-request",
      "axis:ai:send-streaming-request",
      "axis:ai:stream-event",
      "axis:conversations:list",
      "axis:conversations:search",
      "axis:conversations:get",
      "axis:conversations:save",
      "axis:conversations:rename",
      "axis:conversations:delete",
      "axis:conversations:clear-all",
      "axis:conversations:export",
      "axis:conversations:export-all",
      "axis:conversations:import",
      "axis:conversations:import-all",
      "axis:conversations:import-from-text"
    ];
    expect(new Set(channels)).toEqual(new Set(expected));
    expect(new Set(channels).size).toBe(channels.length);
  });
});
