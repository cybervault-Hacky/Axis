import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { APP_CONFIG } from "../../app/config";
import { getPageTitle } from "../../app/navigation";
import { APP_SHORTCUTS, formatShortcut, isMacPlatform } from "../../app/shortcuts";
import { useCommand } from "../../features/command/CommandProvider";
import { useUIPreferences } from "../../features/preferences/UIPreferencesProvider";
import { useSystemStatus } from "../../features/system/SystemStatusProvider";
import { AxisMark } from "../icons/AxisMark";
import { StatusIndicator } from "../ui/StatusIndicator";
import { Tooltip } from "../ui/Tooltip";

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

type WindowAction = "minimize" | "maximize" | "close";

async function runWindowAction(action: WindowAction): Promise<void> {
  if (!isTauriRuntime()) return;

  const appWindow = getCurrentWindow();
  if (action === "minimize") await appWindow.minimize();
  if (action === "maximize") await appWindow.toggleMaximize();
  if (action === "close") await appWindow.close();
}

export function TitleBar() {
  const { pathname } = useLocation();
  const { openPalette } = useCommand();
  const { sidebarCollapsed, compactViewport, toggleSidebar } = useUIPreferences();
  const systemStatus = useSystemStatus();
  const title = getPageTitle(pathname);
  const shortcutLabel = useMemo(
    () => formatShortcut(APP_SHORTCUTS.commandPalette, isMacPlatform()),
    [],
  );

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <AxisMark className="titlebar__mark" size={23} />
        <span className="titlebar__wordmark">{APP_CONFIG.name}</span>
        {!compactViewport && (
          <Tooltip label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} placement="bottom">
            <button
              className="titlebar__sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!sidebarCollapsed}
              onClick={toggleSidebar}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={15} strokeWidth={1.7} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={15} strokeWidth={1.7} aria-hidden="true" />
              )}
            </button>
          </Tooltip>
        )}
      </div>

      <div className="titlebar__context" data-tauri-drag-region>
        <span className="titlebar__page" data-tauri-drag-region>
          {title}
        </span>
        <button
          className="titlebar__command-trigger"
          type="button"
          onClick={openPalette}
          aria-label={`Open command palette, ${shortcutLabel}`}
        >
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Search or navigate</span>
          <kbd>{shortcutLabel}</kbd>
        </button>
      </div>

      <div className="titlebar__tools">
        <StatusIndicator
          label={systemStatus.label}
          tone={systemStatus.tone}
          compact
          className="titlebar__status"
        />
        <div className="window-controls" aria-label="Window controls">
          <button
            className="window-control"
            type="button"
            aria-label="Minimize window"
            onClick={() => void runWindowAction("minimize")}
          >
            <Minus size={14} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            className="window-control"
            type="button"
            aria-label="Maximize window"
            onClick={() => void runWindowAction("maximize")}
          >
            <Maximize2 size={12} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            className="window-control window-control--close"
            type="button"
            aria-label="Close window"
            onClick={() => void runWindowAction("close")}
          >
            <X size={14} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
