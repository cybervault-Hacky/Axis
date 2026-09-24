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
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { APP_CONFIG } from "../app/config";
import { AxisMark } from "../components/icons/AxisMark";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusIndicator } from "../components/ui/StatusIndicator";
import { useNotifications } from "../features/notifications/NotificationProvider";
import { useUIPreferences } from "../features/preferences/UIPreferencesProvider";
import { useTheme } from "../features/theme/ThemeProvider";
import type { ThemePreference } from "../features/theme/theme";
import { classNames } from "../lib/classNames";

const settingsSections = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI", icon: Bot },
  { id: "apps", label: "Connected Apps", icon: Boxes },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "security", label: "Security", icon: LockKeyhole },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "about", label: "About", icon: Info },
] as const;

type SettingsSectionId = (typeof settingsSections)[number]["id"];

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

function LinkedSettings({ type }: { type: "ai" | "apps" }) {
  const isAi = type === "ai";
  return (
    <SettingsPanel
      title={isAi ? "AI" : "Connected Apps"}
      description={
        isAi
          ? "Provider settings will live in the dedicated AI workspace."
          : "Connector settings will be managed alongside supported applications."
      }
    >
      <Card className="settings-link-card">
        <span className="settings-link-card__icon" aria-hidden="true">
          {isAi ? <Bot size={21} /> : <Boxes size={21} />}
        </span>
        <span className="settings-link-card__copy">
          <strong>{isAi ? "No provider connected" : "No applications connected"}</strong>
          <small>
            {isAi
              ? "Provider authentication is planned for a later phase."
              : "Application connectors are planned for later phases."}
          </small>
        </span>
        <Link to={isAi ? "/ai" : "/apps"} className="settings-link-card__link">
          Open {isAi ? "AI" : "Apps"}
          <ChevronRight size={15} aria-hidden="true" />
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
  return (
    <SettingsPanel
      title="Security"
      description="Security controls will be introduced with credentials, connectors, and execution."
    >
      <Card className="settings-card">
        <div className="setting-row">
          <span><strong>Provider credentials</strong><small>No API keys have been requested</small></span>
          <Badge tone="positive">None stored</Badge>
        </div>
        <div className="setting-row">
          <span><strong>External access</strong><small>No application connectors are active</small></span>
          <Badge tone="positive">Inactive</Badge>
        </div>
      </Card>
      <p className="settings-context-note">No simulated vault, credential validation, or security claims are included in Phase 2.</p>
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
      <p className="settings-context-note">AI execution, app integrations, billing, and workflow runs remain reserved for future phases.</p>
    </SettingsPanel>
  );
}

function SettingsContent({ section }: { section: SettingsSectionId }) {
  if (section === "general") return <GeneralSettings />;
  if (section === "appearance") return <AppearanceSettings />;
  if (section === "ai") return <LinkedSettings type="ai" />;
  if (section === "apps") return <LinkedSettings type="apps" />;
  if (section === "permissions") return <PermissionsSettings />;
  if (section === "security") return <SecuritySettings />;
  if (section === "notifications") return <NotificationSettings />;
  return <AboutSettings />;
}

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSectionId>("general");

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
              onClick={() => setSection(item.id)}
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
