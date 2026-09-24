import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useUIPreferences } from "../../features/preferences/UIPreferencesProvider";
import { Sidebar } from "../navigation/Sidebar";
import { TitleBar } from "./TitleBar";

export function AppShell() {
  const location = useLocation();
  const contentRef = useRef<HTMLElement>(null);
  const { sidebarCollapsed } = useUIPreferences();

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div
      className="app-frame"
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <TitleBar />
      <div className="app-shell">
        <Sidebar />
        <main id="main-content" ref={contentRef} className="main-content" tabIndex={-1}>
          <div className="page-transition" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
