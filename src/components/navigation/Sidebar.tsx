import { NavLink } from "react-router-dom";
import { APP_CONFIG } from "../../app/config";
import { primaryNavigation, utilityNavigation } from "../../app/navigation";
import { classNames } from "../../lib/classNames";
import { StatusIndicator } from "../ui/StatusIndicator";

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar__workspace" aria-label="Current environment">
        <span className="sidebar__workspace-label">Environment</span>
        <span className="sidebar__workspace-name">Local foundation</span>
        <span className="sidebar__workspace-state">Phase 1</span>
      </div>

      <nav className="sidebar__nav">
        <span className="sidebar__section-label">Navigate</span>
        <div className="sidebar__nav-list">
          {primaryNavigation.map((item) => (
            <NavLink
              key={item.path}
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
          ))}
        </div>
      </nav>

      <div className="sidebar__bottom">
        <nav className="sidebar__nav sidebar__nav--utility" aria-label="Application navigation">
          {utilityNavigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                classNames("nav-item", isActive && "nav-item--active")
              }
              aria-label={item.label}
            >
              <item.icon className="nav-item__icon" size={18} strokeWidth={1.8} aria-hidden="true" />
              <span className="nav-item__label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__runtime">
          <StatusIndicator label="Ready" detail="Desktop foundation" tone="ready" />
          <span className="sidebar__version">{APP_CONFIG.version}</span>
        </div>
      </div>
    </aside>
  );
}
