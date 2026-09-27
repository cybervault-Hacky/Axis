import {
  Bell,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  Info,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Settings2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { APP_CONFIG } from "../app/config";
import { AxisMark } from "../components/icons/AxisMark";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusIndicator } from "../components/ui/StatusIndicator";
import { ProviderStatus } from "../features/ai/components/ProviderStatus";
import { useAIProviders } from "../features/ai/state/AIProviderProvider";
import { useNotifications } from "../features/notifications/NotificationProvider";
import { useUIPreferences } from "../features/preferences/UIPreferencesProvider";
import { useTheme } from "../features/theme/ThemeProvider";
import type { ThemePreference } from "../features/theme/theme";
import { classNames } from "../lib/classNames";

const settingsSections = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI Providers", icon: Bot },
  { id: "apps", label: "Connected Apps", icon: Boxes },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "security", label: "Security", icon: LockKeyhole },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "about", label: "About", icon: Info },
] as const;

type SettingsSectionId = (typeof settingsSections)[number]["id"];

function isSettingsSection(value: string | null): value is SettingsSectionId {
  return settingsSections.some((section) => section.id === value);
}

const themes: Array<{
  id: ThemePreference;
  title: string;
  description: string;
  icon: typeof Moon;
}> = [
  { id: "dark", title: "Dark", description: "A calm, focused workspace", icon: Moon },
  { id: "light", title: "Light", description: "Bright and carefully balanced", icon: Sun },
  { id: "system", title: "System", description: "Match your desktop setting", icon: Monitor },
];

interface SettingsPanelProps {
  title: string;
  description: string;
  children: ReactNode;
}

function SettingsPanel({ title, description, children }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

function GeneralSettings() {
  const { sidebarPreference, compactViewport, setSidebarPreference } = useUIPreferences();

  return (
    <SettingsPanel
      title="General"
      description="Core interface preferences for this desktop workspace."
    >
      <Card className="settings-card">
        <div className="setting-row">
          <span><strong>Application</strong><small>Desktop product name</small></span>
          <span className="setting-row__value">{APP_CONFIG.name}</span>
        </div>
        <div className="setting-row setting-row--choice">
          <span><strong>Sidebar</strong><small>Choose a comfortable navigation width</small></span>
          <div className="setting-choice" role="group" aria-label="Sidebar appearance">
            <button
              type="button"
              aria-pressed={sidebarPreference === "expanded"}
              disabled={compactViewport}
              onClick={() => setSidebarPreference("expanded")}
            >
              <PanelLeft size={14} aria-hidden="true" />Expanded
            </button>
            <button
              type="button"
              aria-pressed={sidebarPreference === "collapsed"}
              disabled={compactViewport}
              onClick={() => setSidebarPreference("collapsed")}
            >
              <PanelLeftClose size={14} aria-hidden="true" />Compact
            </button>
          </div>
        </div>
        <div className="setting-row">
          <span><strong>Environment</strong><small>Current product foundation</small></span>
          <Badge>{APP_CONFIG.phase}</Badge>
        </div>
      </Card>
      <p className="settings-context-note">
        AXIS automatically uses compact navigation in smaller windows. Press Ctrl or Command + K to search and navigate.
      </p>
    </SettingsPanel>
  );
}

function AppearanceSettings() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const { notify } = useNotifications();

  return (
    <SettingsPanel
      title="Appearance"
      description="Choose how AXIS looks. Your preference is stored on this device."
    >
      <div className="theme-options" role="group" aria-label="Color theme">
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={classNames("theme-option", preference === theme.id && "theme-option--selected")}
            aria-pressed={preference === theme.id}
            onClick={() => {
              if (preference === theme.id) return;
              setPreference(theme.id);
              notify({
                tone: "success",
                title: "Appearance updated",
                message: `${theme.title} mode is now selected.`,
              });
            }}
          >
            <span className={classNames("theme-preview", `theme-preview--${theme.id}`)} aria-hidden="true">
              <span className="theme-preview__sidebar" />
              <span className="theme-preview__content">
                <span />
                <span />
                <span />
              </span>
            </span>
            <span className="theme-option__details">
              <span className="theme-option__icon"><theme.icon size={16} aria-hidden="true" /></span>
              <span><strong>{theme.title}</strong><small>{theme.description}</small></span>
              {preference === theme.id && <Check size={16} className="theme-option__check" aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
      <Card className="appearance-summary" tone="subtle">
        <span>Current interface</span>
        <strong>{resolvedTheme === "dark" ? "Dark" : "Light"}</strong>
        {preference === "system" && <Badge>Following system</Badge>}
      </Card>
    </SettingsPanel>
  );
}

function AIProviderSettings() {
  const {
    selectedProvider,
    selectedConfig,
    selectedRuntime,
    credentialBackendAvailable,
  } = useAIProviders();
  const selectedModel = selectedProvider?.models.find(
    (model) => model.id === selectedConfig?.selectedModelId,
  );
  const modelLabel = selectedProvider?.customModel
    ? selectedConfig?.selectedModelId
    : selectedModel?.displayName;

  return (
    <SettingsPanel
      title="AI Providers"
      description="Choose and verify the provider that will power the future AXIS Agent Engine."
    >
      <Card className="settings-card">
        <div className="setting-row">
          <span><strong>Selected AI</strong><small>The provider currently assigned to AXIS</small></span>
          <span className="setting-row__value">
            {selectedProvider?.displayName ?? "Not selected"}
          </span>
        </div>
        <div className="setting-row">
          <span><strong>Model</strong><small>Safe preference stored on this device</small></span>
          <span className="setting-row__value">{modelLabel || "Not selected"}</span>
        </div>
        <div className="setting-row">
          <span><strong>Connection</strong><small>Verified only after a real provider response</small></span>
          {selectedRuntime
            ? <ProviderStatus status={selectedRuntime.connectionStatus} />
            : <Badge>Not configured</Badge>}
        </div>
        <div className="setting-row">
          <span><strong>Credential boundary</strong><small>No key is stored in browser storage</small></span>
          <Badge tone={credentialBackendAvailable ? "positive" : "warning"}>
            {credentialBackendAvailable ? "Native store ready" : "Desktop required"}
          </Badge>
        </div>
      </Card>
      <Link to="/ai" className="settings-provider-action">
        Manage AI providers <ChevronRight size={15} aria-hidden="true" />
      </Link>
      <p className="settings-context-note">
        Provider connection testing is active in Phase 4. Prompt generation and tool execution remain disabled.
      </p>
    </SettingsPanel>
  );
}

function ConnectedAppsSettings() {
  return (
    <SettingsPanel
      title="Connected Apps"
      description="Connector settings will be managed alongside supported applications."
    >
      <Card className="settings-link-card">
        <span className="settings-link-card__icon" aria-hidden="true">
          <Boxes size={21} />
        </span>
        <span className="settings-link-card__copy">
          <strong>No applications connected</strong>
          <small>Application connectors are planned for later phases.</small>
        </span>
        <Link to="/apps" className="settings-link-card__link">
          Open Apps <ChevronRight size={15} aria-hidden="true" />
        </Link>
      </Card>
    </SettingsPanel>
  );
}

function PermissionsSettings() {
  return (
    <SettingsPanel
      title="Permissions"
      description="Native and application permissions will remain visible and explicit."
    >
      <Card className="settings-state-card" tone="subtle">
        <StatusIndicator label="No permissions requested" detail="AXIS is not controlling external applications." tone="ready" />
        <Badge>Foundation state</Badge>
      </Card>
      <p className="settings-context-note">Future connectors will request only the access they need and expose approval controls here.</p>
    </SettingsPanel>
  );
}

function SecuritySettings() {
  const { providerStates, credentialBackendAvailable } = useAIProviders();
  const configuredCredentialCount = Object.values(providerStates).filter(
    (provider) => provider.credentialConfigured,
  ).length;

  return (
    <SettingsPanel
      title="Security"
      description="Provider keys remain behind a narrow native credential boundary."
    >
      <Card className="settings-card">
        <div className="setting-row">
          <span><strong>Native credential store</strong><small>OS-backed storage; never localStorage or sessionStorage</small></span>
          <Badge tone={credentialBackendAvailable ? "positive" : "warning"}>
            {credentialBackendAvailable ? "Available" : "Unavailable"}
          </Badge>
        </div>
        <div className="setting-row">
          <span><strong>Provider credentials</strong><small>Only presence metadata reaches the interface</small></span>
          <span className="setting-row__value">
            {configuredCredentialCount} configured
          </span>
        </div>
        <div className="setting-row">
          <span><strong>External app access</strong><small>No application connectors or control bridges are active</small></span>
          <Badge tone="positive">Inactive</Badge>
        </div>
      </Card>
      <p className="settings-context-note">
        AXIS does not expose a command that returns saved keys to the webview. Linux storage also requires an available desktop Secret Service.
      </p>
    </SettingsPanel>
  );
}

function NotificationSettings() {
  return (
    <SettingsPanel
      title="Notifications"
      description="AXIS uses restrained in-app messages for immediate interface feedback."
    >
      <Card className="settings-state-card" tone="subtle">
        <StatusIndicator label="In-app feedback ready" detail="Local interface updates can appear as dismissible messages." tone="ready" />
        <Badge tone="positive">Active</Badge>
      </Card>
      <p className="settings-context-note">System notifications for background tasks and approvals will only be added when those capabilities exist.</p>
    </SettingsPanel>
  );
}

function AboutSettings() {
  return (
    <SettingsPanel title="About AXIS" description="Desktop foundation and product information.">
      <Card className="about-card" tone="raised">
        <AxisMark className="about-card__mark" size={46} />
        <div className="about-card__copy">
          <h3>{APP_CONFIG.name}</h3>
          <p>{APP_CONFIG.tagline}</p>
        </div>
        <div className="about-card__meta">
          <span>Version {APP_CONFIG.version}</span>
          <Badge>{APP_CONFIG.phase}</Badge>
        </div>
      </Card>
      <p className="settings-context-note">Provider configuration and real connection checks are included in Phase 4. AI generation, app integrations, billing, and workflow runs remain reserved for future phases.</p>
    </SettingsPanel>
  );
}

function SettingsContent({ section }: { section: SettingsSectionId }) {
  if (section === "general") return <GeneralSettings />;
  if (section === "appearance") return <AppearanceSettings />;
  if (section === "ai") return <AIProviderSettings />;
  if (section === "apps") return <ConnectedAppsSettings />;
  if (section === "permissions") return <PermissionsSettings />;
  if (section === "security") return <SecuritySettings />;
  if (section === "notifications") return <NotificationSettings />;
  return <AboutSettings />;
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const section: SettingsSectionId = isSettingsSection(requestedSection)
    ? requestedSection
    : "general";

  return (
    <section className="page page--settings">
      <PageHeader
        eyebrow="Settings"
        title="Make AXIS feel like yours."
        description="Manage the preferences that are available today and see what is prepared for later phases."
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={classNames("settings-nav__item", section === item.id && "settings-nav__item--active")}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => {
                void setSearchParams(
                  item.id === "general" ? {} : { section: item.id },
                  { replace: true },
                );
              }}
            >
              <item.icon size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
              <ChevronRight size={13} className="settings-nav__chevron" aria-hidden="true" />
            </button>
          ))}
        </nav>
        <div className="settings-content" aria-live="polite">
          <SettingsContent section={section} />
        </div>
      </div>
    </section>
  );
}
