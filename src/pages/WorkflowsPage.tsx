import {
  ArrowDown,
  Box,
  Github,
  Palette,
  Plus,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";

const conceptStages = [
  { icon: Box, app: "Blender", task: "Model and render" },
  { icon: Palette, app: "Canva", task: "Create campaign design" },
  { icon: Github, app: "GitHub", task: "Update the project" },
] as const;

export function WorkflowsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section className="page page--workflows">
      <PageHeader
        eyebrow="Workflows"
        title="Complex work, one clear flow."
        description="Workflows will let AXIS coordinate structured, multi-app outcomes with visible steps and approval points."
        actions={
          <Button
            variant="primary"
            leadingIcon={<Plus size={16} />}
            onClick={() => setDialogOpen(true)}
          >
            New workflow
          </Button>
        }
      />

      <Card className="workflow-concept-card" tone="raised">
        <div className="workflow-concept-card__header">
          <div>
            <p className="section-heading__eyebrow">Illustrative workflow</p>
            <h2>From an idea to a finished handoff</h2>
          </div>
          <Badge>Example only</Badge>
        </div>

        <div className="workflow-concept" aria-label="Example future workflow">
          {conceptStages.map((stage, index) => (
            <div className="workflow-concept__group" key={stage.app}>
              <div className="workflow-node">
                <span className="workflow-node__icon" aria-hidden="true">
                  <stage.icon size={19} strokeWidth={1.65} />
                </span>
                <span className="workflow-node__copy">
                  <strong>{stage.app}</strong>
                  <small>{stage.task}</small>
                </span>
                <span className="workflow-node__index">0{index + 1}</span>
              </div>
              {index < conceptStages.length - 1 && (
                <div className="workflow-connector" aria-hidden="true">
                  <span />
                  <ArrowDown size={14} />
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="workflow-concept-card__caption">
          This diagram communicates the planned workflow model. It does not run or connect to these applications.
        </p>
      </Card>

      <Card className="workflow-empty" tone="subtle">
        <EmptyState
          compact
          icon={<Workflow size={22} />}
          title="No workflows yet"
          description="Saved workflows will appear here when the builder and execution engine are available."
          action={
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              About the workflow builder
            </Button>
          }
        />
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Workflow execution is not active"
        description="Phase 1 establishes the experience without pretending to run tools or background tasks."
        footer={
          <Button variant="primary" onClick={() => setDialogOpen(false)}>
            Understood
          </Button>
        }
      >
        <div className="dialog-feature-list">
          <p>The future builder is prepared for:</p>
          <ul>
            <li>Ordered steps across supported apps</li>
            <li>Visible approvals and permission gates</li>
            <li>Run state, errors, and detailed history</li>
          </ul>
        </div>
      </Dialog>
    </section>
  );
}
