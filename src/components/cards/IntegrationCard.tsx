import type { LucideIcon } from "lucide-react";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";

export type IntegrationState = "connected" | "available" | "not-connected" | "coming-soon";

const statePresentation: Record<
  IntegrationState,
  { label: string; detail: string; tone: "neutral" | "accent" | "positive" }
> = {
  connected: { label: "Connected", detail: "Connector active", tone: "positive" },
  available: { label: "Available", detail: "Ready to configure", tone: "accent" },
  "not-connected": { label: "Not connected", detail: "No active connection", tone: "neutral" },
  "coming-soon": { label: "Coming later", detail: "Connector planned", tone: "neutral" },
};

interface IntegrationCardProps {
  name: string;
  description: string;
  category: string;
  icon: LucideIcon;
  state: IntegrationState;
}

export function IntegrationCard({
  name,
  description,
  category,
  icon: Icon,
  state,
}: IntegrationCardProps) {
  const presentation = statePresentation[state];

  return (
    <Card className="app-card">
      <div className="app-card__topline">
        <span className="app-card__icon" aria-hidden="true">
          <Icon size={22} strokeWidth={1.6} />
        </span>
        <Badge tone={presentation.tone}>{presentation.label}</Badge>
      </div>
      <div className="app-card__copy">
        <h2>{name}</h2>
        <p>{description}</p>
      </div>
      <div className="app-card__footer">
        <span>{category}</span>
        <span className="app-card__state">
          <span aria-hidden="true" />{presentation.detail}
        </span>
      </div>
    </Card>
  );
}
