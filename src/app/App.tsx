import { Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { ActivityPage } from "../pages/ActivityPage";
import { AiPage } from "../pages/AiPage";
import { AppsPage } from "../pages/AppsPage";
import { HomePage } from "../pages/HomePage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PointsPage } from "../pages/PointsPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { WorkflowsPage } from "../pages/WorkflowsPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="ai" element={<AiPage />} />
        <Route path="apps" element={<AppsPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="workflows" element={<WorkflowsPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="points" element={<PointsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
