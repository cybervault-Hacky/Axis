import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  CircleGauge,
  Clock3,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusIndicator } from "../components/ui/StatusIndicator";
import { connectionStatusPresentation } from "../features/ai/components/providerStatusPresentation";
import { useAIProviders } from "../features/ai/state/AIProviderProvider";
import { CommandComposer } from "../features/command/CommandComposer";
import { useCommand } from "../features/command/CommandProvider";
import { useNotifications } from "../features/notifications/NotificationProvider";
import { useSystemStatus } from "../features/system/SystemStatusProvider";

export function HomePage() {
  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const { draft, setDraft, focusRequest } = useCommand();
  const { notify } = useNotifications();
  const { selectedProvider, selectedConfig, selectedRuntime } = useAIProviders();
  const systemStatus = useSystemStatus();
  const providerStatus = selectedRuntime
    ? connectionStatusPresentation[selectedRuntime.connectionStatus]
    : null;
  const selectedModel = selectedProvider?.models.find(
    (model) => model.id === selectedConfig?.selectedModelId,
  );
  const selectedModelLabel = selectedProvider?.customModel
    ? selectedConfig?.selectedModelId
    : selectedModel?.displayName;

  useEffect(() => {
    if (focusRequest === 0) return;
    window.requestAnimationFrame(() => commandInputRef.current?.focus());
  }, [focusRequest]);

  const explainUnavailableExecution = () => {
    notify({
      tone: "information",
      title: "Command execution is not available yet",
      message: "Your draft was not submitted. Phase 4 verifies providers but does not send prompts or run tools.",
    });
  };

  return (
    <section className="page page--home">
      <PageHeader
        eyebrow="Workspace"
        title="What would you like to accomplish?"
        description="Start with the outcome. AXIS is being built to plan the work and coordinate the right tools."
      />

      <CommandComposer
        ref={commandInputRef}
        value={draft}
        onValueChange={setDraft}
        onUnavailableAttempt={explainUnavailableExecution}
        status="unavailable"
        providerContext={
          selectedProvider && providerStatus ? (
            <span className="composer-provider-status">
              <span className={`composer-provider-status__dot composer-provider-status__dot--${providerStatus.tone}`} aria-hidden="true" />
              <span>{selectedProvider.shortName}</span>
              <span aria-hidden="true">·</span>
              <strong>{providerStatus.label}</strong>
            </span>
          ) : (
            <Badge tone="warning">No provider connected</Badge>
          )
        }
        action={
          <Link className="button button--secondary button--medium" to="/ai">
            <span className="button__label">
              {selectedProvider ? "Manage AI" : "Connect AI"}
            </span>
            <span className="button__icon"><ArrowRight size={14} aria-hidden="true" /></span>
          </Link>
        }
      />

      <div className="home-context-grid">
        <Card className="home-activity-empty" tone="subtle">
          <div className="home-panel-heading">
            <div>
              <p className="section-heading__eyebrow">Recent activity</p>
              <h2>Your work will appear here</h2>
            </div>
            <Clock3 size={17} aria-hidden="true" />
          </div>
          <div className="home-activity-empty__body">
            <span className="home-activity-empty__icon" aria-hidden="true">
              <Activity size={20} strokeWidth={1.7} />
            </span>
            <div>
              <strong>No tasks have run</strong>
              <p>When execution is introduced, completed tasks and approval events will be visible here.</p>
            </div>
          </div>
          <Link className="home-panel-link" to="/activity">
            Open activity <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </Card>

        <Card className="home-snapshot" tone="subtle">
          <div className="home-panel-heading">
            <div>
              <p className="section-heading__eyebrow">Workspace state</p>
              <h2>Local foundation</h2>
            </div>
            <StatusIndicator label={systemStatus.label} tone={systemStatus.tone} compact />
          </div>
          <div className="home-snapshot__rows">
            <Link to="/ai" className="home-snapshot__row">
              <span><Bot size={15} aria-hidden="true" />AI provider</span>
              <Badge tone={providerStatus?.tone ?? "neutral"}>
                {selectedProvider ? selectedProvider.shortName : "Not selected"}
              </Badge>
            </Link>
            {selectedProvider && (
              <Link to="/ai" className="home-snapshot__row">
                <span><Bot size={15} aria-hidden="true" />Model</span>
                <Badge>{selectedModelLabel || "Not selected"}</Badge>
              </Link>
            )}
            <Link to="/apps" className="home-snapshot__row">
              <span><Boxes size={15} aria-hidden="true" />Connected apps</span>
              <Badge>0 connected</Badge>
            </Link>
            <Link to="/points" className="home-snapshot__row">
              <span><CircleGauge size={15} aria-hidden="true" />Points</span>
              <Badge>Not active</Badge>
            </Link>
          </div>
        </Card>
      </div>
    </section>
  );
}
