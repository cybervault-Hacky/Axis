import { createSidebar } from "./components/sidebar";
import { createAboutDialog } from "./components/aboutDialog";
import { createHomeView } from "./views/home";
import { createWorkspaceView } from "./views/workspace";
import { createHistoryView } from "./views/history";
import { createToolsView } from "./views/tools";
import { createSettingsView } from "./views/settings";
import { createStore } from "./state";
import { getAiStatus } from "./ai/aiClient";
import { icons } from "./icons";
import { h } from "./dom";
import { NAV_ITEMS, type ViewId } from "./types";
import { buildFolderExpansionNotices, dragCarriesFiles, expandDroppedEntries } from "./dragDropFiles";

/**
 * Mounts the full AXIS shell into `root`. Kept as a single composition
 * function so it can be exercised from tests against a detached container,
 * independent of the real `index.html` bootstrap in main.ts.
 */
export function mountApp(root: HTMLElement) {
  const store = createStore();

  root.classList.add("axis-app");

  const sidebar = createSidebar(store);

  const views: Record<ViewId, HTMLElement> = {
    home: createHomeView(store),
    workspace: createWorkspaceView(store),
    history: createHistoryView(store),
    tools: createToolsView(),
    settings: createSettingsView(store)
  };

  // Fetch the real AI engine status once at startup, for whichever provider
  // is currently selected (honest default until this resolves — see
  // UNKNOWN_AI_STATUS in state.ts). Settings re-fetches this itself after
  // import/remove/test/provider-switch actions so every view stays live.
  void getAiStatus(store.getState().settings.aiProvider).then((status) => store.setAiStatus(status));

  const topbarTitle = h("span", { className: "axis-topbar__title", id: "axis-topbar-title" }, ["Home"]);
  const sidebarToggleBtn = h(
    "button",
    {
      type: "button",
      className: "axis-btn axis-btn--ghost axis-btn--icon",
      "aria-label": "Toggle sidebar",
      "data-tooltip": "Toggle sidebar"
    },
    [icons.menu()]
  );
  sidebarToggleBtn.addEventListener("click", () => store.toggleSidebar());

  const topbar = h("header", { className: "axis-topbar" }, [
    h("div", { className: "axis-topbar__actions" }, [sidebarToggleBtn, topbarTitle])
  ]);

  const viewHost = h("div", { className: "axis-view-host" }, Object.values(views));
  const main = h("main", { className: "axis-main" }, [topbar, viewHost]);

  const aboutDialog = createAboutDialog(store);

  // Purely decorative: two slow, low-opacity drifting shapes behind the
  // real interface (see .axis-ambient in layout.css). `aria-hidden` keeps
  // it out of the accessibility tree; `pointer-events: none` (in CSS)
  // keeps it from ever intercepting a click, scroll, or keyboard action.
  const ambientBackground = h("div", { className: "axis-ambient", "aria-hidden": "true" }, [
    h("span", { className: "axis-ambient__blob axis-ambient__blob--a" }),
    h("span", { className: "axis-ambient__blob axis-ambient__blob--b" })
  ]);

  root.append(ambientBackground, sidebar, main, aboutDialog);

  const labels: Record<ViewId, string> = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item.label])) as Record<
    ViewId,
    string
  >;

  function applyAttentionSafeAttr(name: string, value: string): void {
    document.documentElement.setAttribute(name, value);
  }

  store.subscribe((state) => {
    for (const [id, el] of Object.entries(views) as Array<[ViewId, HTMLElement]>) {
      el.hidden = id !== state.activeView;
    }
    topbarTitle.textContent = labels[state.activeView];

    root.setAttribute("data-sidebar", state.settings.sidebarCollapsed ? "collapsed" : "expanded");
    applyAttentionSafeAttr("data-accent", state.settings.accent);
    applyAttentionSafeAttr("data-density", state.settings.density);
    applyAttentionSafeAttr("data-motion", state.settings.motion);

    document.title = `${labels[state.activeView]} · AXIS`;
  });

  // Phase 16: a conversation export file can be dropped anywhere in the
  // window, not just onto History's own list (Phase 13). History's drop
  // zone calls `stopPropagation()` on all four of these event types, so a
  // drop that lands there is never seen here — this listener only ever
  // fires for a drop elsewhere in the shell (sidebar, topbar, or any other
  // view), and `requestImportDroppedFiles` both switches to History and
  // hands it the file list; History shows the outcome using its existing
  // success/error states, so no new notification UI is introduced here.
  let shellDragDepth = 0;

  root.addEventListener("dragenter", (event) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    shellDragDepth += 1;
    root.classList.add("axis-app--drop-active");
  });

  root.addEventListener("dragover", (event) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });

  root.addEventListener("dragleave", (event) => {
    if (!dragCarriesFiles(event)) return;
    shellDragDepth = Math.max(0, shellDragDepth - 1);
    if (shellDragDepth === 0) root.classList.remove("axis-app--drop-active");
  });

  root.addEventListener("drop", (event) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    shellDragDepth = 0;
    root.classList.remove("axis-app--drop-active");
    const dataTransfer = event.dataTransfer;
    void (async () => {
      // Phase 17: expand any dropped folder(s) into the files they contain
      // before handing them to History's import pipeline, exactly like the
      // History view's own drop zone now also does. Phase 18: `notices`
      // reports whether that expansion hit the depth/file-count caps, and
      // is carried through the store alongside the files so History can
      // still report it even though the limit was hit here, not there.
      const expansion = await expandDroppedEntries(dataTransfer);
      const notices = buildFolderExpansionNotices(expansion);
      if (expansion.files.length > 0 || notices.length > 0) store.requestImportDroppedFiles(expansion.files, notices);
    })();
  });

  return { store };
}
