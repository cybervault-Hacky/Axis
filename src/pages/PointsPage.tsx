import { CircleGauge, Gauge, Info, Layers3, ReceiptText } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";

const futurePointDetails = [
  {
    icon: Gauge,
    title: "Transparent usage",
    detail: "See how points relate to tasks before and after a run.",
  },
  {
    icon: Layers3,
    title: "Monthly allowance",
    detail: "Track the allocation included with a future plan.",
  },
  {
    icon: ReceiptText,
    title: "Clear history",
    detail: "Review point events alongside task activity.",
  },
] as const;

export function PointsPage() {
  return (
    <section className="page page--points">
      <PageHeader
        eyebrow="Points"
        title="Simple usage, clearly measured."
        description="The AXIS points system will make task usage understandable without hiding the details."
        actions={<Badge>Not active</Badge>}
      />

      <div className="points-layout">
        <Card className="points-balance-card" tone="raised">
          <div className="points-balance-card__header">
            <div>
              <p className="section-heading__eyebrow">Current balance</p>
              <div className="points-balance">
                <span aria-label="Balance unavailable">—</span>
                <small>points</small>
              </div>
            </div>
            <span className="points-balance-card__icon" aria-hidden="true">
              <CircleGauge size={22} strokeWidth={1.6} />
            </span>
          </div>

          <div className="points-meter" aria-label="Points usage unavailable">
            <div className="points-meter__track" />
            <div className="points-meter__labels">
              <span>Usage not started</span>
              <span>Allowance not assigned</span>
            </div>
          </div>

          <div className="points-summary-rows">
            <div>
              <span>Monthly allowance</span>
              <strong>Not available</strong>
            </div>
            <div>
              <span>Current plan</span>
              <strong>No plan configured</strong>
            </div>
            <div>
              <span>Renewal</span>
              <strong>Not scheduled</strong>
            </div>
          </div>
        </Card>

        <Card className="points-explainer" tone="subtle">
          <div className="section-heading section-heading--compact">
            <div>
              <p className="section-heading__eyebrow">Planned system</p>
              <h2>Designed to stay legible</h2>
            </div>
          </div>
          <div className="points-feature-list">
            {futurePointDetails.map((item) => (
              <div className="points-feature" key={item.title}>
                <span className="points-feature__icon" aria-hidden="true">
                  <item.icon size={17} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="points-history-card" tone="subtle">
        <div className="points-history-card__heading">
          <div>
            <p className="section-heading__eyebrow">Transaction history</p>
            <h2>No point activity</h2>
          </div>
          <Badge>0 events</Badge>
        </div>
        <div className="points-history-card__empty">
          <ReceiptText size={18} aria-hidden="true" />
          <p>Future point allocations and usage events will be listed here with clear task context.</p>
        </div>
      </Card>

      <div className="points-notice">
        <Info size={16} aria-hidden="true" />
        <p>
          <strong>Points and billing are not implemented in Phase 2.</strong> No balance is calculated and no points can be spent or deducted.
        </p>
      </div>
    </section>
  );
}
