import { h } from "../dom";
import { icons } from "../icons";
import type { AxisStore } from "../state";
import { NAV_ITEMS, type ViewId } from "../types";

const NAV_ICON: Record<ViewId, () => SVGSVGElement> = {
  home: icons.home,
  workspace: icons.workspace,
  history: icons.history,
  tools: icons.tools,
  settings: icons.settings
};

export function createSidebar(store: AxisStore): HTMLElement {
  const brandMark = h("div", { className: "axis-sidebar__mark", "aria-hidden": "true" }, ["A"]);
  const brandText = h("div", { className: "axis-sidebar__brand-text" }, [
    h("span", { className: "axis-sidebar__name" }, ["AXIS"]),
    h("span", { className: "axis-sidebar__tagline" }, ["One AI. Every Tool."])
  ]);
  const brand = h("div", { className: "axis-sidebar__brand" }, [brandMark, brandText]);

  const navButtons = new Map<ViewId, HTMLButtonElement>();
  const navList = h("nav", { className: "axis-nav", "aria-label": "Primary" });
  for (const item of NAV_ITEMS) {
    // `data-tooltip` and `aria-label` are always present so the control has
    // a reliable name and a native-feeling tooltip whenever its text label
    // is visually hidden — whether that's because the sidebar is collapsed
    // or the window is too narrow to show labels (see layout.css).
    const button = h("button", {
      type: "button",
      className: "axis-nav__item",
      id: `nav-${item.id}`,
      "data-view": item.id,
      "aria-label": item.label,
      "data-tooltip": item.label
    }) as HTMLButtonElement;
    const iconWrap = h("span", { className: "axis-nav__icon" }, [NAV_ICON[item.id]()]);
    const label = h("span", { className: "axis-nav__label" }, [item.label]);
    button.append(iconWrap, label);
    button.addEventListener("click", () => store.setActiveView(item.id));
    navButtons.set(item.id, button);
    navList.append(button);
  }

  const aboutButton = h(
    "button",
    {
      type: "button",
      className: "axis-nav__item",
      id: "axis-about-trigger",
      "aria-label": "About AXIS",
      "data-tooltip": "About AXIS"
    },
    [h("span", { className: "axis-nav__icon" }, [icons.info()]), h("span", { className: "axis-nav__label" }, ["About AXIS"])]
  ) as HTMLButtonElement;
  aboutButton.addEventListener("click", () => store.openAbout());

  const collapseIcon = icons.chevronLeft();
  collapseIcon.classList.add("axis-sidebar__collapse-icon");
  const collapseButton = h(
    "button",
    {
      type: "button",
      className: "axis-nav__item",
      id: "axis-sidebar-toggle",
      "aria-label": "Collapse sidebar",
      "data-tooltip": "Collapse sidebar"
    },
    [h("span", { className: "axis-nav__icon" }, [collapseIcon]), h("span", { className: "axis-nav__label" }, ["Collapse"])]
  ) as HTMLButtonElement;
  collapseButton.addEventListener("click", () => store.toggleSidebar());

  const footer = h("div", { className: "axis-sidebar__footer" }, [aboutButton, collapseButton]);

  const sidebar = h("aside", { className: "axis-sidebar" }, [brand, navList, footer]);

  store.subscribe((state) => {
    for (const [id, button] of navButtons) {
      if (id === state.activeView) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }

    const collapsed = state.settings.sidebarCollapsed;
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    collapseButton.setAttribute("aria-label", label);
    collapseButton.setAttribute("data-tooltip", label);
    collapseButton.classList.toggle("axis-sidebar__toggle--expand", collapsed);
  });

  return sidebar;
}
