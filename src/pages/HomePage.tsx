import {
  ArrowRight,
  Bot,
  Boxes,
  Check,
  CircleGauge,
  Clock3,
  Command,
  FolderKanban,
  LockKeyhole,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusIndicator } from "../components/ui/StatusIndicator";

const setupItems = [
  {
    icon: Bot,
    title: "Choose your AI",
    detail: "Provider connections are prepared for a future phase.",
    path: "/ai",
    action: "View AI setup",
  },
  {
    icon: Boxes,
    title: "Review supported apps",
    detail: "Explore the connector foundation without simulated connections.",
    path: "/apps",
    action: "Browse apps",
  },
  {
    icon: FolderKanban,
    title: "Organize work in projects",
    detail: "Project creation will arrive with real local persistence.",
    path: "/projects",
    action: "View projects",
  },
] as const;

export function HomePage() {
  const [command, setCommand] = useState("");

  return (
    <section className="page page--home">
      <PageHeader
        eyebrow="Home"
        title="What would you like to accomplish?"
        description="Describe the outcome. AXIS will eventually plan the work and coordinate the right tools."
        actions={<StatusIndicator label="Foundation ready" tone="ready" />}
      />

      <Card className="command-surface" tone="raised">
        <div className="command-surface__topline">
          <div className="command-surface__identity">
            <span className="command-surface__icon" aria-hidden="true">
              <Command size={18} strokeWidth={1.8} />
            </span>
            <div>
              <span className="command-surface__label">Command workspace</span>
              <span className="command-surface__hint">Natural-language tasks</span>
            </div>
          </div>
          <Badge tone="warning">Setup required</Badge>
        </div>

        <label className="command-composer">
          <span className="sr-only">Tell AXIS what you want to accomplish</span>
          <textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Tell AXIS what you want to accomplish..."
            rows={3}
            maxLength={1200}
          />
        </label>

        <div className="command-surface__footer">
          <div className="command-privacy-note">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Commands are not submitted or executed in Phase 1.</span>
          </div>
          <Link className="button button--primary button--medium" to="/ai">
            <span className="button__label">Configure AI</span>
            <span className="button__icon">
              <ArrowRight size={15} aria-hidden="true" />
            </span>
          </Link>
        </div>
      </Card>

      <div className="home-overview">
        <Card className="setup-panel">
          <div className="section-heading">
            <div>
              <p className="section-heading__eyebrow">Getting started</p>
              <h2>Prepare your workspace</h2>
            </div>
            <span className="section-heading__meta">0 of 3</span>
          </div>

          <div className="setup-list">
            {setupItems.map((item, index) => (
              <Link className="setup-item" to={item.path} key={item.title}>
                <span className="setup-item__number">0{index + 1}</span>
                <span className="setup-item__icon" aria-hidden="true">
                  <item.icon size={17} strokeWidth={1.8} />
                </span>
                <span className="setup-item__copy">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </span>
                <span className="setup-item__action">
                  {item.action}
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </Card>

        <div className="home-side-stack">
          <Card className="readiness-card" tone="subtle">
            <div className="section-heading section-heading--compact">
              <div>
                <p className="section-heading__eyebrow">System</p>
                <h2>Runtime readiness</h2>
              </div>
              <CircleGauge size={18} aria-hidden="true" />
            </div>
            <div className="readiness-list">
              <div className="readiness-row">
                <span><Check size={14} aria-hidden="true" />Desktop shell</span>
                <Badge tone="positive">Ready</Badge>
              </div>
              <div className="readiness-row">
                <span><Bot size={14} aria-hidden="true" />AI provider</span>
                <Badge>Not configured</Badge>
              </div>
              <div className="readiness-row">
                <span><Boxes size={14} aria-hidden="true" />App connectors</span>
                <Badge>None connected</Badge>
              </div>
            </div>
          </Card>

          <Card className="recent-card" tone="subtle">
            <div className="recent-card__icon" aria-hidden="true">
              <Clock3 size={18} />
            </div>
            <div>
              <h2>No recent activity</h2>
              <p>Completed tasks and approvals will appear here once execution is available.</p>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
