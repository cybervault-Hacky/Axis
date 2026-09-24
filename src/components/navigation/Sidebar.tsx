import { Command } from "lucide-react";
import { NavLink } from "react-router-dom";
import { APP_CONFIG } from "../../app/config";
import { primaryNavigation, utilityNavigation } from "../../app/navigation";
import { useCommand } from "../../features/command/CommandProvider";
import { useUIPreferences } from "../../features/preferences/UIPreferencesProvider";
import { useSystemStatus } from "../../features/system/SystemStatusProvider";
import { classNames } from "../../lib/classNames";
import { StatusIndicator } from "../ui/StatusIndicator";
import { Tooltip } from "../ui/Tooltip";

export function Sidebar() {
  const { requestCommandFocus } = useCommand();
  const { sidebarCollapsed } = useUIPreferences();
  const systemStatus = useSystemStatus();

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <Tooltip label="Start a command" placement="right" disabled={!sidebarCollapsed}>
        <button
          className="sidebar__command"
          type="button"
          onClick={requestCommandFocus}
          aria-label="Start a command"
        >
          <Command size={17} strokeWidth={1.9} aria-hidden="true" />
          <span>New command</span>
        </button>
      </Tooltip>

      <nav className="sidebar__nav">
        <span className="sidebar__section-label">Workspace</span>
        <div className="sidebar__nav-list">
          {primaryNavigation.map((item) => (
            <Tooltip
              key={item.path}
              label={item.label}
              placement="right"
              disabled={!sidebarCollapsed}
            >
              <NavLink
                to={item.path}
                end={item.end}
                className={({ isActive }) =>
                  classNames("nav-item", isActive && "nav-item--active")
                }
                aria-label={item.label}
              >
                <item.icon className="nav-item__icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span className="nav-item__label">{item.label}</span>
              </NavLink>
            </Tooltip>
          ))}
        </div>
      </nav>

      <div className="sidebar__bottom">
        <nav className="sidebar__nav sidebar__nav--utility" aria-label="Application navigation">
          {utilityNavigation.map((item) => (
            <Tooltip
              key={item.path}
              label={item.label}
              placement="right"
              disabled={!sidebarCollapsed}
            >
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  classNames("nav-item", isActive && "nav-item--active")
                }
                aria-label={item.label}
              >
                <item.icon className="nav-item__icon" size={18} strokeWidth={1.8} aria-hidden="true" />
                <span className="nav-item__label">{item.label}</span>
              </NavLink>
            </Tooltip>
          ))}
        </nav>

        <Tooltip
          label={`${systemStatus.label} — ${systemStatus.detail}`}
          placement="right"
          disabled={!sidebarCollapsed}
        >
          <span className="sidebar__runtime">
            <StatusIndicator
              label={systemStatus.label}
              detail={systemStatus.detail}
              tone={systemStatus.tone}
            />
            <span className="sidebar__version">{APP_CONFIG.version}</span>
          </span>
        </Tooltip>
      </div>
    </aside>
  );
}
