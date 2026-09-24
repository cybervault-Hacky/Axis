import { Boxes, SearchX } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { IntegrationCard } from "../components/cards/IntegrationCard";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchField } from "../components/ui/SearchField";
import { appCategories, plannedApps, type AppCategory } from "../data/apps";
import { classNames } from "../lib/classNames";

export function AppsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory>("All");
  const deferredQuery = useDeferredValue(query);

  const filteredApps = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
    return plannedApps.filter((app) => {
      const matchesCategory = category === "All" || app.category === category;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        `${app.name} ${app.description}`.toLocaleLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, deferredQuery]);

  return (
    <section className="page page--apps">
      <PageHeader
        eyebrow="Connected apps"
        title="Bring every tool into focus."
        description="AXIS connectors will coordinate work across your professional apps. Connections are not available yet."
        actions={<Badge tone="neutral">0 connected</Badge>}
      />

      <Card className="app-toolbar" tone="subtle">
        <SearchField
          label="Search planned apps"
          placeholder="Search apps"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
        />
        <div className="filter-tabs" aria-label="Filter apps by category">
          {appCategories.map((item) => (
            <button
              key={item}
              className={classNames("filter-tab", item === category && "filter-tab--active")}
              type="button"
              aria-pressed={item === category}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <span className="app-toolbar__count">
          {filteredApps.length} {filteredApps.length === 1 ? "app" : "apps"}
        </span>
      </Card>

      {filteredApps.length > 0 ? (
        <div className="apps-grid" aria-live="polite">
          {filteredApps.map((app) => (
            <IntegrationCard
              key={app.name}
              name={app.name}
              description={app.description}
              category={app.category}
              icon={app.icon}
              state="coming-soon"
            />
          ))}
        </div>
      ) : (
        <Card className="apps-no-results">
          <EmptyState
            compact
            icon={<SearchX size={22} />}
            title="No apps match your search"
            description="Try a different name or category."
          />
        </Card>
      )}

      <div className="apps-foundation-note">
        <Boxes size={16} aria-hidden="true" />
        <p>
          <strong>Connector foundation only.</strong> No apps are connected and no external app control is simulated in Phase 2.
        </p>
      </div>
    </section>
  );
}
