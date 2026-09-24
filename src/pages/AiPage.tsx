import { Bot, Check, ChevronRight, Cpu, KeyRound, LockKeyhole, Sparkles } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusIndicator } from "../components/ui/StatusIndicator";

const providers = [
  { name: "OpenAI", monogram: "O", description: "GPT model family" },
  { name: "Anthropic", monogram: "A", description: "Claude model family" },
  { name: "Google", monogram: "G", description: "Gemini model family" },
  { name: "Compatible API", monogram: "C", description: "OpenAI-compatible endpoint" },
] as const;

const setupSteps = [
  { label: "Select a provider", detail: "Choose the intelligence behind AXIS." },
  { label: "Add credentials", detail: "Secure credential storage arrives with provider support." },
  { label: "Choose a model", detail: "Set a default model for planning and execution." },
] as const;

export function AiPage() {
  return (
    <section className="page page--ai">
      <PageHeader
        eyebrow="Intelligence"
        title="Your AI, under your control."
        description="AXIS is designed to work with the provider and model you choose. No provider is connected yet."
        actions={<StatusIndicator label="Not connected" tone="idle" />}
      />

      <div className="ai-overview-grid">
        <Card className="ai-connection-card" tone="raised">
          <div className="ai-connection-card__visual" aria-hidden="true">
            <div className="ai-orbit ai-orbit--outer" />
            <div className="ai-orbit ai-orbit--inner" />
            <div className="ai-core">
              <Bot size={25} strokeWidth={1.55} />
            </div>
          </div>
          <div className="ai-connection-card__copy">
            <Badge tone="warning">Provider required</Badge>
            <h2>Connect an AI provider to start using AXIS.</h2>
            <p>
              Provider authentication and model requests are intentionally not active in this phase.
              This screen is ready for the real connection flow.
            </p>
          </div>
          <div className="ai-connection-card__facts">
            <div>
              <span>Provider</span>
              <strong>Not selected</strong>
            </div>
            <div>
              <span>Model</span>
              <strong>Unavailable</strong>
            </div>
            <div>
              <span>Credentials</span>
              <strong>Not stored</strong>
            </div>
          </div>
        </Card>

        <Card className="provider-steps-card">
          <div className="section-heading section-heading--compact">
            <div>
              <p className="section-heading__eyebrow">Connection flow</p>
              <h2>Designed for a clear setup</h2>
            </div>
            <Sparkles size={18} aria-hidden="true" />
          </div>
          <ol className="provider-steps">
            {setupSteps.map((step, index) => (
              <li key={step.label}>
                <span className="provider-step__index">{index + 1}</span>
                <span>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="provider-steps-card__note">
            <LockKeyhole size={15} aria-hidden="true" />
            <span>No API keys are requested or stored in Phase 2.</span>
          </div>
        </Card>
      </div>

      <div className="content-section">
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">Providers</p>
            <h2>Built for choice</h2>
            <p className="section-heading__description">
              These provider entries show the planned management structure, not active connections.
            </p>
          </div>
          <Badge>All coming later</Badge>
        </div>

        <div className="provider-grid">
          {providers.map((provider) => (
            <Card className="provider-card" tone="subtle" key={provider.name}>
              <span className="provider-card__monogram" aria-hidden="true">
                {provider.monogram}
              </span>
              <div className="provider-card__copy">
                <strong>{provider.name}</strong>
                <span>{provider.description}</span>
              </div>
              <Badge>Planned</Badge>
            </Card>
          ))}
        </div>
      </div>

      <Card className="ai-architecture-strip" tone="subtle">
        <div className="architecture-item">
          <Cpu size={17} aria-hidden="true" />
          <span><strong>Provider</strong><small>Your selected AI service</small></span>
        </div>
        <ChevronRight size={15} className="architecture-arrow" aria-hidden="true" />
        <div className="architecture-item">
          <KeyRound size={17} aria-hidden="true" />
          <span><strong>Credential vault</strong><small>Prepared for secure native storage</small></span>
        </div>
        <ChevronRight size={15} className="architecture-arrow" aria-hidden="true" />
        <div className="architecture-item">
          <Check size={17} aria-hidden="true" />
          <span><strong>Model ready</strong><small>Available after a verified connection</small></span>
        </div>
      </Card>
    </section>
  );
}
