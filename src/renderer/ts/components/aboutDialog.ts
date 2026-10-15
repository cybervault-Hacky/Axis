import { h } from "../dom";
import { icons } from "../icons";
import type { AxisStore } from "../state";

const FOUNDERS: Array<{ name: string; role: string }> = [
  { name: "Sarthak Bharambe", role: "Founder" },
  { name: "Rudra Zambare", role: "Co-Founder" }
];

export function createAboutDialog(store: AxisStore): HTMLElement {
  const closeButton = h(
    "button",
    {
      type: "button",
      className: "axis-btn axis-btn--ghost axis-btn--icon",
      "aria-label": "Close dialog",
      "data-tooltip": "Close",
      "data-tooltip-position": "bottom"
    },
    [icons.close()]
  ) as HTMLButtonElement;

  const versionLine = h("p", { className: "axis-dialog__meta", id: "axis-about-version" }, [
    "Version 0.1.0 · Foundation & UI preview build"
  ]);

  const creditList = h(
    "div",
    { className: "axis-credit-list" },
    FOUNDERS.map((founder) =>
      h("div", { className: "axis-credit" }, [
        h("span", { className: "axis-credit__name" }, [founder.name]),
        h("span", { className: "axis-credit__role" }, [founder.role])
      ])
    )
  );

  const dialog = h(
    "div",
    {
      className: "axis-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "axis-about-title",
      "aria-describedby": "axis-about-tagline"
    },
    [
      h("div", { className: "axis-dialog__header" }, [
        h("div", { className: "axis-dialog__mark", "aria-hidden": "true" }, ["A"]),
        closeButton
      ]),
      h("div", {}, [
        h("h2", { className: "axis-dialog__title", id: "axis-about-title" }, ["AXIS"]),
        h("p", { className: "axis-dialog__tagline", id: "axis-about-tagline" }, ["One AI. Every Tool."])
      ]),
      h("div", { className: "axis-dialog__section" }, [h("p", { className: "axis-section-label" }, ["Credits"]), creditList]),
      versionLine,
      h("div", { className: "axis-dialog__footer" }, [
        h("button", { type: "button", className: "axis-btn axis-btn--secondary", id: "axis-about-done" }, ["Close"])
      ])
    ]
  );

  const doneButton = dialog.querySelector<HTMLButtonElement>("#axis-about-done");
  doneButton?.addEventListener("click", () => store.closeAbout());
  closeButton.addEventListener("click", () => store.closeAbout());

  const overlay = h(
    "div",
    { className: "axis-dialog-overlay", id: "axis-about-overlay", hidden: true },
    [dialog]
  );

  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) store.closeAbout();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) {
      store.closeAbout();
    }
  });

  let lastFocused: HTMLElement | null = null;

  overlay.addEventListener("focusin", (event) => {
    if (!dialog.contains(event.target as Node)) {
      closeButton.focus();
    }
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  store.subscribe((state) => {
    if (state.aboutOpen) {
      if (overlay.hidden) {
        lastFocused = document.activeElement as HTMLElement | null;
        overlay.hidden = false;
        closeButton.focus();
      }
    } else if (!overlay.hidden) {
      overlay.hidden = true;
      lastFocused?.focus();
    }
  });

  void window.axis
    ?.getAppInfo()
    .then((info) => {
      versionLine.textContent = `Version ${info.version} · Electron ${info.electronVersion} · ${info.platform}`;
    })
    .catch(() => {
      // Bridge unavailable (e.g. browser preview) — keep the static label.
    });

  return overlay;
}
