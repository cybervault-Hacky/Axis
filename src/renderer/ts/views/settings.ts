import { h } from "../dom";
import { createPageHeader } from "../components/pageHeader";
import { createStatusArea } from "../components/statusArea";
import { getAiStatus, importCredential, removeCredential, testConnection } from "../ai/aiClient";
import { AI_PROVIDER_IDS, AI_PROVIDER_LABELS, type AiProviderId } from "../../../shared/ai-contract";
import type { AxisStore } from "../state";
import type { AccentTheme, AiRequestTimeout, Density, MotionPreference } from "../types";

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * An accessible, keyboard-operable segmented control following the ARIA
 * "radiogroup" pattern: only the active option sits in the tab order, and
 * Arrow keys move + select between options (Home/End jump to the ends).
 */
function createSegmented<T extends string | number>(
  options: Array<{ id: T; label: string }>,
  getValue: () => T,
  onSelect: (value: T) => void
): HTMLElement {
  const buttons: Array<{ id: T; el: HTMLButtonElement }> = [];

  function select(id: T, focus: boolean): void {
    onSelect(id);
    if (focus) buttons.find((b) => b.id === id)?.el.focus();
  }

  const el = h("div", { className: "axis-segmented", role: "radiogroup" });

  options.forEach((opt, index) => {
    const isActive = opt.id === getValue();
    const btn = h(
      "button",
      {
        type: "button",
        className: "axis-segmented__option",
        role: "radio",
        "aria-checked": String(isActive),
        tabindex: isActive ? "0" : "-1"
      },
      [opt.label]
    ) as HTMLButtonElement;

    btn.addEventListener("click", () => select(opt.id, false));

    btn.addEventListener("keydown", (event) => {
      const lastIndex = options.length - 1;
      let targetIndex: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        targetIndex = index === lastIndex ? 0 : index + 1;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        targetIndex = index === 0 ? lastIndex : index - 1;
      } else if (event.key === "Home") {
        targetIndex = 0;
      } else if (event.key === "End") {
        targetIndex = lastIndex;
      }
      if (targetIndex !== null) {
        event.preventDefault();
        const target = options[targetIndex];
        if (target) select(target.id, true);
      }
    });

    buttons.push({ id: opt.id, el: btn });
    el.append(btn);
  });

  function sync(): void {
    const current = getValue();
    for (const { id, el: btn } of buttons) {
      const active = id === current;
      btn.setAttribute("aria-checked", String(active));
      btn.setAttribute("tabindex", active ? "0" : "-1");
    }
  }

  el.addEventListener("axis-sync", sync);
  return el;
}

function createSwitchRow(label: string, description: string, getChecked: () => boolean, onToggle: () => void) {
  const descId = nextId("axis-switch-desc");
  const toggle = h("button", {
    type: "button",
    className: "axis-switch",
    role: "switch",
    "aria-checked": String(getChecked()),
    "aria-label": label,
    "aria-describedby": descId
  }) as HTMLButtonElement;
  toggle.addEventListener("click", onToggle);

  const row = h("div", { className: "axis-settings-row" }, [
    h("div", {}, [
      h("p", { className: "axis-settings-row__label" }, [label]),
      h("p", { className: "axis-settings-row__desc", id: descId }, [description])
    ]),
    h("div", { className: "axis-settings-row__control" }, [toggle])
  ]);

  return { row, toggle };
}

function createSettingsRow(label: string, description: string, control: HTMLElement): HTMLElement {
  const labelId = nextId("axis-settings-label");
  control.setAttribute("aria-labelledby", labelId);
  return h("div", { className: "axis-settings-row" }, [
    h("div", {}, [
      h("p", { className: "axis-settings-row__label", id: labelId }, [label]),
      h("p", { className: "axis-settings-row__desc" }, [description])
    ]),
    h("div", { className: "axis-settings-row__control" }, [control])
  ]);
}

export function createSettingsView(store: AxisStore): HTMLElement {
  const header = createPageHeader({
    eyebrow: "Settings",
    title: "Preferences",
    description: "Changes apply immediately and are saved on this device only — no account, no cloud sync.",
    titleId: "settings-title"
  });

  const accentControl = createSegmented<AccentTheme>(
    [
      { id: "blue", label: "Blue" },
      { id: "graphite", label: "Graphite" }
    ],
    () => store.getState().settings.accent,
    (value) => store.updateSettings({ accent: value })
  );

  const densityControl = createSegmented<Density>(
    [
      { id: "comfortable", label: "Comfortable" },
      { id: "compact", label: "Compact" }
    ],
    () => store.getState().settings.density,
    (value) => store.updateSettings({ density: value })
  );

  const motionControl = createSegmented<MotionPreference>(
    [
      { id: "system", label: "Match system" },
      { id: "reduced", label: "Reduce" },
      { id: "expressive", label: "Full" }
    ],
    () => store.getState().settings.motion,
    (value) => store.updateSettings({ motion: value })
  );

  const timeoutControl = createSegmented<AiRequestTimeout>(
    [
      { id: 15000, label: "15s" },
      { id: 30000, label: "30s" },
      { id: 60000, label: "60s" }
    ],
    () => store.getState().settings.aiRequestTimeoutMs,
    (value) => store.updateSettings({ aiRequestTimeoutMs: value })
  );

  const sidebarSwitch = createSwitchRow(
    "Collapse sidebar",
    "Show icon-only navigation to maximize workspace width. Stays in sync with the sidebar's own collapse control.",
    () => store.getState().settings.sidebarCollapsed,
    () => store.toggleSidebar()
  );

  const appearanceGroup = h("div", { className: "axis-settings-group" }, [
    createSettingsRow("Accent colour", "Restrained accent used for active states and highlights.", accentControl),
    createSettingsRow("Layout density", "Adjust spacing throughout the interface.", densityControl),
    sidebarSwitch.row
  ]);

  const motionGroup = h("div", { className: "axis-settings-group" }, [
    createSettingsRow(
      "Motion",
      "Controls interface animation. \"Match system\" follows your OS reduced-motion setting; \"Reduce\" always " +
        "minimizes motion; \"Full\" always animates.",
      motionControl
    )
  ]);

  const appearanceSection = h("section", { "aria-label": "Appearance settings" }, [
    h("div", { className: "axis-section-label" }, ["Appearance"]),
    appearanceGroup
  ]);
  const motionSection = h("section", { "aria-label": "Accessibility settings" }, [
    h("div", { className: "axis-section-label" }, ["Accessibility"]),
    motionGroup
  ]);

  // ------------------------------- AI Engine -------------------------------
  // Extends the existing Settings screen (no redesign) with provider
  // selection, status, and credential actions (Phase 9: Gemini or OpenAI).
  // All real work happens in the main process via
  // src/renderer/ts/ai/aiClient.ts — this view only reflects results and
  // never sees the raw key. Every action below is scoped to whichever
  // provider is currently selected; switching providers only changes which
  // credential bucket/status is being read or written, never both at once.

  function currentProvider(): AiProviderId {
    return store.getState().settings.aiProvider;
  }

  const providerControl = createSegmented<AiProviderId>(
    AI_PROVIDER_IDS.map((id) => ({ id, label: AI_PROVIDER_LABELS[id] })),
    currentProvider,
    (value) => {
      if (value === currentProvider()) return;
      store.updateSettings({ aiProvider: value });
      aiMessage.textContent = "";
      void refreshAiStatus();
    }
  );

  const aiStatusArea = createStatusArea("settings-ai");

  const aiMessage = h(
    "p",
    { className: "axis-settings-row__desc", id: "settings-ai-message", role: "status", "aria-live": "polite" },
    []
  );

  const importButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--secondary", id: "settings-ai-import" },
    ["Import key file…"]
  ) as HTMLButtonElement;
  const sessionOnlyButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--ghost", id: "settings-ai-session-only", hidden: true },
    ["Use for this session only"]
  ) as HTMLButtonElement;
  const testButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--secondary", id: "settings-ai-test" },
    ["Test connection"]
  ) as HTMLButtonElement;
  const removeButton = h(
    "button",
    { type: "button", className: "axis-btn axis-btn--ghost", id: "settings-ai-remove", hidden: true },
    ["Remove saved key"]
  ) as HTMLButtonElement;

  let aiActionBusy = false;

  function syncAiButtons(): void {
    const aiStatus = store.getState().aiStatus;
    importButton.disabled = aiActionBusy || !aiStatus.nativeBridgeAvailable;
    sessionOnlyButton.hidden = !aiStatus.nativeBridgeAvailable || aiStatus.persistentStorageAvailable;
    sessionOnlyButton.disabled = aiActionBusy;
    testButton.disabled = aiActionBusy || !aiStatus.nativeBridgeAvailable || !aiStatus.configured;
    removeButton.hidden = !aiStatus.configured;
    removeButton.disabled = aiActionBusy;
  }

  async function refreshAiStatus(): Promise<void> {
    store.setAiStatus(await getAiStatus(currentProvider()));
  }

  async function withAiBusy(action: () => Promise<void>): Promise<void> {
    aiActionBusy = true;
    syncAiButtons();
    try {
      await action();
    } finally {
      aiActionBusy = false;
      syncAiButtons();
    }
  }

  importButton.addEventListener("click", () => {
    void withAiBusy(async () => {
      const result = await importCredential({ provider: currentProvider() });
      if (result.ok) {
        aiMessage.textContent =
          result.backend === "session"
            ? "Key saved for this session only — it will not be written to disk."
            : "Key imported and stored encrypted on this device.";
      } else if (result.code === "CANCELLED") {
        aiMessage.textContent = "Import cancelled — no changes were made.";
      } else {
        aiMessage.textContent = result.message ?? "Could not import that key.";
      }
      await refreshAiStatus();
    });
  });

  sessionOnlyButton.addEventListener("click", () => {
    void withAiBusy(async () => {
      const result = await importCredential({ allowSessionOnly: true, provider: currentProvider() });
      if (result.ok) {
        aiMessage.textContent = "Key saved for this session only — it will not be written to disk.";
      } else if (result.code === "CANCELLED") {
        aiMessage.textContent = "Import cancelled — no changes were made.";
      } else {
        aiMessage.textContent = result.message ?? "Could not import that key.";
      }
      await refreshAiStatus();
    });
  });

  testButton.addEventListener("click", () => {
    void withAiBusy(async () => {
      const providerLabel = AI_PROVIDER_LABELS[currentProvider()];
      const result = await testConnection(currentProvider());
      aiMessage.textContent = result.ok
        ? `Connection verified — ${providerLabel} responded successfully.`
        : result.message ?? "Connection test failed.";
    });
  });

  removeButton.addEventListener("click", () => {
    void withAiBusy(async () => {
      const result = await removeCredential(currentProvider());
      aiMessage.textContent = result.ok ? "Saved key removed from this device." : result.message ?? "Could not remove the saved key.";
      await refreshAiStatus();
    });
  });

  const aiActionsRow = h("div", { className: "axis-settings-ai__actions" }, [
    importButton,
    sessionOnlyButton,
    testButton,
    removeButton
  ]);

  const aiCostNote = h("p", { className: "axis-settings-row__desc", id: "settings-ai-cost-note" }, []);

  const COST_NOTES: Record<AiProviderId, string> = {
    gemini:
      "Using Gemini sends your message to Google's Gemini API under your own Google account. This may incur " +
      "usage costs or be subject to quotas under Google's current terms — AXIS does not add any billing of its own.",
    openai:
      "Using OpenAI sends your message to OpenAI's API under your own OpenAI account. This may incur " +
      "usage costs or be subject to quotas under OpenAI's current terms — AXIS does not add any billing of its own.",
    anthropic:
      "Using Claude sends your message to Anthropic's API under your own Anthropic account. This may incur " +
      "usage costs or be subject to quotas under Anthropic's current terms — AXIS does not add any billing of its own.",
    mistral:
      "Using Mistral sends your message to Mistral AI's API under your own Mistral account. This may incur " +
      "usage costs or be subject to quotas under Mistral's current terms — AXIS does not add any billing of its own."
  };

  const aiGroup = h("div", { className: "axis-settings-group" }, [
    createSettingsRow("Provider", "Which AI provider Home and the AI Workspace send requests to.", providerControl),
    aiStatusArea.element,
    aiActionsRow,
    aiMessage,
    aiCostNote,
    createSettingsRow(
      "Request timeout",
      "How long AXIS waits for a response before stopping the request automatically.",
      timeoutControl
    )
  ]);

  const aiSection = h("section", { "aria-label": "AI engine settings" }, [
    h("div", { className: "axis-section-label" }, ["AI Engine"]),
    aiGroup
  ]);

  const inner = h("div", { className: "axis-view__inner" }, [header, appearanceSection, motionSection, aiSection]);
  const view = h("section", { className: "axis-view", id: "view-settings", role: "tabpanel", "aria-labelledby": "nav-settings" }, [
    inner
  ]);

  store.subscribe((state) => {
    accentControl.dispatchEvent(new Event("axis-sync"));
    densityControl.dispatchEvent(new Event("axis-sync"));
    motionControl.dispatchEvent(new Event("axis-sync"));
    timeoutControl.dispatchEvent(new Event("axis-sync"));
    providerControl.dispatchEvent(new Event("axis-sync"));
    sidebarSwitch.toggle.setAttribute("aria-checked", String(state.settings.sidebarCollapsed));
    aiCostNote.textContent = COST_NOTES[state.settings.aiProvider];
    aiStatusArea.update(state.aiStatus);
    syncAiButtons();
  });

  return view;
}
