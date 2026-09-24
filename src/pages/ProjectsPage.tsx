import { FolderKanban, HardDrive, Plus, SearchX } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchField } from "../components/ui/SearchField";

export function ProjectsPage() {
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section className="page page--projects">
      <PageHeader
        eyebrow="Projects"
        title="A home for every outcome."
        description="Projects will keep task context, files, workflows, and activity together as AXIS grows."
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus size={16} />}
            onClick={() => setDialogOpen(true)}
          >
            New project
          </Button>
        }
      />

      <div className="collection-toolbar">
        <SearchField
          label="Search projects"
          placeholder="Search projects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
        />
        <Badge>0 projects</Badge>
      </div>

      <Card className="collection-empty" tone="subtle">
        <EmptyState
          icon={query ? <SearchX size={23} /> : <FolderKanban size={23} />}
          title={query ? "No projects to search yet" : "Your projects will live here"}
          description={
            query
              ? "Project search is ready, but no project records exist in Phase 2."
              : "Create focused workspaces for goals, source files, instructions, and future AXIS runs. Real project persistence is planned for a later phase."
          }
          action={
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Learn about project setup
            </Button>
          }
        />
      </Card>

      <div className="future-schema" aria-label="Planned project structure">
        <span><FolderKanban size={15} aria-hidden="true" />Project context</span>
        <span><HardDrive size={15} aria-hidden="true" />Local files</span>
        <span><Badge>Future</Badge>Activity and workflows</span>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Project creation is coming later"
        description="The entry point is in place, but AXIS does not create or store projects in Phase 2."
        footer={
          <Button variant="primary" onClick={() => setDialogOpen(false)}>
            Got it
          </Button>
        }
      >
        <div className="dialog-feature-list">
          <p>Future project support will add:</p>
          <ul>
            <li>Durable local project records</li>
            <li>Task context and linked source files</li>
            <li>Connected workflows and execution history</li>
          </ul>
        </div>
      </Dialog>
    </section>
  );
}
