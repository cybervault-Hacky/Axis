import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { APP_CONFIG } from "../../app/config";
import { getPageTitle } from "../../app/navigation";
import { AxisMark } from "../icons/AxisMark";
import { Badge } from "../ui/Badge";
import { StatusIndicator } from "../ui/StatusIndicator";

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
  const title = getPageTitle(pathname);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <AxisMark className="titlebar__mark" size={23} />
        <span className="titlebar__wordmark">{APP_CONFIG.name}</span>
      </div>

      <div className="titlebar__context" data-tauri-drag-region>
        <span className="titlebar__page" data-tauri-drag-region>
          {title}
        </span>
      </div>

      <div className="titlebar__tools">
        <Badge className="titlebar__phase">Foundation</Badge>
        <StatusIndicator
          label="Ready"
          tone="ready"
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
