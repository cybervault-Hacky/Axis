import { beforeEach, describe, expect, it } from "vitest";
import { mountApp } from "../src/renderer/ts/app";

function freshRoot(): HTMLElement {
  document.body.innerHTML = "";
  window.localStorage.clear();
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);
  return root;
}

describe("AXIS app shell", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = freshRoot();
  });

  it("renders all five navigation destinations", () => {
    mountApp(root);
    const navButtons = root.querySelectorAll(".axis-nav[aria-label='Primary'] .axis-nav__item");
    const labels = Array.from(navButtons).map((el) => el.textContent?.trim());
    expect(labels).toEqual(["Home", "AI Workspace", "History", "Tools", "Settings"]);
  });

  it("shows only the home view initially, with Home marked current", () => {
    mountApp(root);
    expect(root.querySelector("#view-home")?.hasAttribute("hidden")).toBe(false);
    expect(root.querySelector("#view-workspace")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector("#nav-home")?.getAttribute("aria-current")).toBe("page");
  });

  it("switches views when a sidebar nav item is clicked", () => {
    mountApp(root);
    const workspaceNav = root.querySelector<HTMLButtonElement>("#nav-workspace");
    workspaceNav?.click();

    expect(root.querySelector("#view-workspace")?.hasAttribute("hidden")).toBe(false);
    expect(root.querySelector("#view-home")?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector("#nav-workspace")?.getAttribute("aria-current")).toBe("page");
    expect(root.querySelector("#nav-home")?.hasAttribute("aria-current")).toBe(false);
  });

  it("populates the composer when an example prompt is clicked", () => {
    mountApp(root);
    const chip = root.querySelector<HTMLButtonElement>("#view-home .axis-prompt-chip");
    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea");
    expect(textarea?.value).toBe("");

    chip?.click();

    expect(textarea?.value.length).toBeGreaterThan(0);
    expect(root.querySelector<HTMLButtonElement>("#home-composer-send")?.disabled).toBe(false);
  });

  it("clears the composer with the Clear button and disables Send again", () => {
    mountApp(root);
    const chip = root.querySelector<HTMLButtonElement>("#view-home .axis-prompt-chip");
    chip?.click();

    const clearButton = root.querySelector<HTMLButtonElement>("#home-composer-clear");
    clearButton?.click();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea");
    expect(textarea?.value).toBe("");
    expect(root.querySelector<HTMLButtonElement>("#home-composer-send")?.disabled).toBe(true);
  });

  it("clears the composer with Escape without submitting anything", () => {
    mountApp(root);
    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea");
    expect(textarea).toBeTruthy();
    if (!textarea) return;

    textarea.value = "draft text";
    textarea.dispatchEvent(new Event("input"));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(textarea.value).toBe("");
  });

  it("never fakes a successful AI response and honestly reports the engine is unavailable", async () => {
    mountApp(root);
    // No window.axis bridge exists in this jsdom/browser-preview test, so
    // the async startup status fetch resolves to the honest "unavailable"
    // default almost immediately — flush microtasks once to let it settle.
    await Promise.resolve();
    await Promise.resolve();

    const textarea = root.querySelector<HTMLTextAreaElement>("#home-composer-textarea");
    textarea!.value = "Hello AXIS";
    textarea!.dispatchEvent(new Event("input"));

    const sendButton = root.querySelector<HTMLButtonElement>("#home-composer-send");
    expect(sendButton?.disabled).toBe(false);
    sendButton?.click();

    const responseTitle = root.querySelector("#home-response-title");
    const responseDetail = root.querySelector("#home-response-detail");
    expect(responseTitle?.textContent?.toLowerCase()).toContain("not sent");
    expect(responseDetail?.textContent?.toLowerCase()).toContain("ai engine");

    // The engine-status area also honestly reports there is no native bridge.
    const statusTitle = root.querySelector("#home-status-title");
    expect(statusTitle?.textContent?.toLowerCase()).toContain("unavailable");

    // The draft must still be present — nothing was silently cleared or sent.
    expect(textarea?.value).toBe("Hello AXIS");
  });

  it("opens and closes the About dialog with founder credits", () => {
    mountApp(root);
    const overlay = root.querySelector<HTMLElement>("#axis-about-overlay");
    expect(overlay?.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>("#axis-about-trigger")?.click();
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.textContent).toContain("Sarthak Bharambe");
    expect(overlay?.textContent).toContain("Rudra Zambare");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(overlay?.hidden).toBe(true);
  });

  it("applies the accent setting to the document element immediately", () => {
    mountApp(root);
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const graphiteButton = Array.from(root.querySelectorAll<HTMLButtonElement>(".axis-segmented__option")).find(
      (btn) => btn.textContent === "Graphite"
    );
    graphiteButton?.click();

    expect(document.documentElement.getAttribute("data-accent")).toBe("graphite");
  });

  it("collapses the sidebar when the collapse control is toggled", () => {
    mountApp(root);
    expect(root.getAttribute("data-sidebar")).toBe("expanded");

    root.querySelector<HTMLButtonElement>("#axis-sidebar-toggle")?.click();

    expect(root.getAttribute("data-sidebar")).toBe("collapsed");
  });

  it("keeps every nav item accessibly named with a tooltip available once the sidebar is collapsed", () => {
    mountApp(root);
    const navHome = root.querySelector<HTMLButtonElement>("#nav-home");
    expect(navHome?.getAttribute("aria-label")).toBe("Home");
    // The tooltip text is always attached (CSS only renders the bubble once
    // collapsed); confirm the content is correct and stable across states.
    expect(navHome?.getAttribute("data-tooltip")).toBe("Home");

    root.querySelector<HTMLButtonElement>("#axis-sidebar-toggle")?.click();

    expect(navHome?.getAttribute("data-tooltip")).toBe("Home");
    expect(root.querySelector<HTMLButtonElement>("#axis-about-trigger")?.getAttribute("data-tooltip")).toBe("About AXIS");
  });


  it("updates the collapse control's own label/tooltip and rotates its icon when toggled", () => {
    mountApp(root);
    const toggle = root.querySelector<HTMLButtonElement>("#axis-sidebar-toggle");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse sidebar");

    toggle?.click();

    expect(toggle?.getAttribute("aria-label")).toBe("Expand sidebar");
    expect(toggle?.getAttribute("data-tooltip")).toBe("Expand sidebar");
    expect(toggle?.classList.contains("axis-sidebar__toggle--expand")).toBe(true);
  });

  it("keeps the Settings sidebar-collapse switch synchronized with the real sidebar state", () => {
    mountApp(root);
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const sidebarSwitch = Array.from(root.querySelectorAll<HTMLButtonElement>(".axis-switch")).find(
      (btn) => btn.getAttribute("aria-label") === "Collapse sidebar"
    );
    expect(sidebarSwitch?.getAttribute("aria-checked")).toBe("false");

    // Toggling from the sidebar itself (not the settings switch) must still
    // update the switch, proving there's one source of truth.
    root.querySelector<HTMLButtonElement>("#axis-sidebar-toggle")?.click();
    expect(sidebarSwitch?.getAttribute("aria-checked")).toBe("true");

    // And toggling the switch itself must move the real sidebar.
    sidebarSwitch?.click();
    expect(root.getAttribute("data-sidebar")).toBe("expanded");
  });

  it("supports roving-tabindex arrow-key navigation on segmented settings controls", () => {
    mountApp(root);
    root.querySelector<HTMLButtonElement>("#nav-settings")?.click();

    const densityGroup = Array.from(root.querySelectorAll<HTMLElement>(".axis-segmented")).find((group) =>
      group.textContent?.includes("Compact")
    );
    expect(densityGroup).toBeTruthy();
    const options = Array.from(densityGroup!.querySelectorAll<HTMLButtonElement>(".axis-segmented__option"));
    const comfortable = options.find((o) => o.textContent === "Comfortable")!;
    const compact = options.find((o) => o.textContent === "Compact")!;

    expect(comfortable.getAttribute("tabindex")).toBe("0");
    expect(compact.getAttribute("tabindex")).toBe("-1");
    expect(comfortable.getAttribute("aria-checked")).toBe("true");

    comfortable.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(compact.getAttribute("aria-checked")).toBe("true");
    expect(compact.getAttribute("tabindex")).toBe("0");
    expect(comfortable.getAttribute("tabindex")).toBe("-1");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("returns focus to the control that opened the About dialog once it closes", () => {
    mountApp(root);
    const trigger = root.querySelector<HTMLButtonElement>("#axis-about-trigger");
    trigger?.focus();
    trigger?.click();

    expect(root.querySelector<HTMLElement>("#axis-about-overlay")?.hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.activeElement).toBe(trigger);
  });

  it("does not close the About dialog when interacting with its own content", () => {
    mountApp(root);
    root.querySelector<HTMLButtonElement>("#axis-about-trigger")?.click();
    const overlay = root.querySelector<HTMLElement>("#axis-about-overlay");
    const dialogBody = root.querySelector<HTMLElement>(".axis-dialog");

    dialogBody?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(overlay?.hidden).toBe(false);
  });

  describe("window-wide drag-and-drop (Phase 16)", () => {
    function dispatchDragEvent(
      target: Element,
      type: "dragenter" | "dragover" | "dragleave" | "drop",
      options: { carriesFiles?: boolean; files?: unknown[] } = {}
    ): void {
      const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        dataTransfer?: { types: string[]; files: unknown; dropEffect: string };
      };
      const carriesFiles = options.carriesFiles ?? true;
      event.dataTransfer = {
        types: carriesFiles ? ["Files"] : ["text/plain"],
        files: options.files ?? [],
        dropEffect: ""
      };
      target.dispatchEvent(event);
    }

    it("toggles the shell-wide drop-active class while dragging a file anywhere in the app", () => {
      mountApp(root);
      const homeView = root.querySelector("#view-home")!;
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);

      dispatchDragEvent(homeView, "dragenter");
      expect(root.classList.contains("axis-app--drop-active")).toBe(true);

      dispatchDragEvent(homeView, "dragleave");
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);
    });

    it("ignores a drag that does not carry files anywhere in the shell", () => {
      mountApp(root);
      const homeView = root.querySelector("#view-home")!;
      dispatchDragEvent(homeView, "dragenter", { carriesFiles: false });
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);
      expect(root.querySelector("#nav-home")?.getAttribute("aria-current")).toBe("page");
    });

    it("navigates to History on drop even without a native bridge, surfacing History's own honest no-bridge state", async () => {
      mountApp(root); // no window.axis installed — plain browser preview, same as other app.test.ts cases
      const homeView = root.querySelector("#view-home")!;
      const file = { name: "dropped.json", text: async () => "{}" };
      dispatchDragEvent(homeView, "drop", { files: [file] });

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(root.querySelector("#nav-history")?.getAttribute("aria-current")).toBe("page");
      expect(root.querySelector("#history-error")).not.toBeNull();
      expect(root.classList.contains("axis-app--drop-active")).toBe(false);
    });
  });
});
