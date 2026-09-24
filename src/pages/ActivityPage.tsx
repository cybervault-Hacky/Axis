import { Activity, ListFilter } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchField } from "../components/ui/SearchField";

export function ActivityPage() {
  const [query, setQuery] = useState("");

  return (
    <section className="page page--activity">
      <PageHeader
        eyebrow="Activity"
        title="Every action, clearly accounted for."
        description="Future task runs, approvals, application events, and results will be recorded here."
        actions={<Badge>0 events</Badge>}
      />

      <div className="collection-toolbar activity-toolbar">
        <SearchField
          label="Search activity"
          placeholder="Search activity"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
        />
        <div className="activity-filter-label">
          <ListFilter size={15} aria-hidden="true" />
          <span>All activity</span>
        </div>
      </div>

      <Card className="activity-table-card" tone="subtle">
        <div className="activity-table" role="table" aria-label="Task activity">
          <div className="activity-table__header" role="row">
            <span role="columnheader">Task</span>
            <span role="columnheader">Application</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Time</span>
          </div>
          <div className="activity-table__empty" role="row">
            <div role="cell" className="activity-table__empty-cell">
              <EmptyState
                compact
                icon={<Activity size={22} />}
                title={query ? "No activity matches your search" : "Nothing has run yet"}
                description={
                  query
                    ? "There are no execution records in Phase 1."
                    : "AXIS will show truthful execution history here once tasks can run. No sample records have been fabricated."
                }
              />
            </div>
          </div>
        </div>
      </Card>

      <p className="table-footnote">
        Activity records will include status, timestamps, involved apps, and execution details.
      </p>
    </section>
  );
}
