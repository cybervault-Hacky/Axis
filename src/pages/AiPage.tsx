import {
  ArrowRight,
  Bot,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { ProviderCard } from "../features/ai/components/ProviderCard";
import { ProviderConfigurationDialog } from "../features/ai/components/ProviderConfigurationDialog";
import { ProviderStatus } from "../features/ai/components/ProviderStatus";
import type { AIProviderId } from "../features/ai/domain/types";
import { aiProviderRegistry } from "../features/ai/providers/registry";
import { useAIProviders } from "../features/ai/state/AIProviderProvider";
import { useNotifications } from "../features/notifications/NotificationProvider";

export function AiPage() {
  const {
    preferences,
    providerStates,
    selectedProvider,
    selectedConfig,
    selectedRuntime,
    credentialBackendAvailable,
    selectProvider,
  } = useAIProviders();
  const { notify } = useNotifications();
  const [configurationProviderId, setConfigurationProviderId] =
    useState<AIProviderId | null>(null);

  const selectedModel = selectedProvider?.models.find(
    (model) => model.id === selectedConfig?.selectedModelId,
  );
  const selectedModelLabel = selectedProvider?.customModel
    ? selectedConfig?.selectedModelId || "Model not selected"
    : selectedModel?.displayName ?? "Model not selected";

  const configureProvider = (providerId: AIProviderId) => {
    const changingProvider = preferences.selectedProviderId !== providerId;
    selectProvider(providerId);
    setConfigurationProviderId(providerId);
    if (changingProvider) {
      notify({
        tone: "information",
        title: `${aiProviderRegistry.get(providerId).shortName} selected`,
        message: "Add a key and test the connection when you are ready.",
      });
    }
  };

  return (
    <section className="page page--ai page--ai-providers">
      <PageHeader
        eyebrow="AI providers"
        title="Your AI, your choice."
        description="Choose the provider that powers AXIS. Your provider account and model remain independent from AXIS."
        actions={
          selectedRuntime
            ? <ProviderStatus status={selectedRuntime.connectionStatus} />
            : <Badge>No provider selected</Badge>
        }
      />

      {selectedProvider && selectedConfig && selectedRuntime ? (
        <Card className="selected-provider-hero" tone="raised">
          <div className="selected-provider-hero__identity">
            <span className="selected-provider-hero__mark" aria-hidden="true">
              {selectedProvider.shortName.slice(0, 1)}
            </span>
            <div>
              <p className="section-heading__eyebrow">Selected AI</p>
              <h2>{selectedProvider.displayName}</h2>
              <p>{selectedProvider.description}</p>
            </div>
          </div>
          <div className="selected-provider-hero__details">
            <div>
              <span>Model</span>
              <strong>{selectedModelLabel}</strong>
            </div>
            <div>
              <span>Credential</span>
              <strong>
                {selectedRuntime.credentialConfigured ? "Native store" : "Not configured"}
              </strong>
            </div>
            <div>
              <span>Connection</span>
              <ProviderStatus status={selectedRuntime.connectionStatus} />
            </div>
          </div>
          <Button
            variant="primary"
            onClick={() => setConfigurationProviderId(selectedProvider.id)}
            trailingIcon={<ArrowRight size={15} aria-hidden="true" />}
          >
            Configure provider
          </Button>
        </Card>
      ) : (
        <Card className="provider-empty-hero" tone="raised">
          <span className="provider-empty-hero__icon" aria-hidden="true">
            <Bot size={25} strokeWidth={1.55} />
          </span>
          <div>
            <Badge tone="warning">Provider required</Badge>
            <h2>Connect the AI layer behind AXIS.</h2>
            <p>
              Select a provider below, save your own API key through the native credential boundary,
              and verify a model. AI generation remains disabled in Phase 4.
            </p>
          </div>
        </Card>
      )}

      {!credentialBackendAvailable && (
        <div className="native-boundary-notice" role="status">
          <LockKeyhole size={16} aria-hidden="true" />
          <div>
            <strong>Native credential storage is unavailable in this preview.</strong>
            <span>No browser-storage fallback is used. Open AXIS through Tauri to configure keys.</span>
          </div>
        </div>
      )}

      <div className="content-section provider-management-section">
        <div className="section-heading">
          <div>
            <p className="section-heading__eyebrow">Provider registry</p>
            <h2>Choose what powers AXIS</h2>
            <p className="section-heading__description">
              Model catalogs are centralized and connection tests verify actual account access.
            </p>
          </div>
          <Badge>{aiProviderRegistry.providers.length} providers</Badge>
        </div>

        <div className="provider-choice-grid">
          {aiProviderRegistry.providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              config={preferences.configs[provider.id]}
              runtime={providerStates[provider.id]}
              selected={preferences.selectedProviderId === provider.id}
              onConfigure={() => configureProvider(provider.id)}
            />
          ))}
        </div>
      </div>

      <Card className="provider-foundation-strip" tone="subtle">
        <div>
          <span><KeyRound size={17} aria-hidden="true" /></span>
          <p><strong>Bring your own key</strong><small>Keys stay behind a native credential API.</small></p>
        </div>
        <div>
          <span><RefreshCw size={17} aria-hidden="true" /></span>
          <p><strong>Real connection checks</strong><small>No connection is marked successful without a provider response.</small></p>
        </div>
        <div>
          <span><SlidersHorizontal size={17} aria-hidden="true" /></span>
          <p><strong>Normalized adapters</strong><small>The future Agent Engine depends on AXIS, not one AI vendor.</small></p>
        </div>
        <div>
          <span><ShieldCheck size={17} aria-hidden="true" /></span>
          <p><strong>Execution still off</strong><small>No prompts or tool actions are sent in this phase.</small></p>
        </div>
      </Card>

      <ProviderConfigurationDialog
        providerId={configurationProviderId}
        open={configurationProviderId !== null}
        onClose={() => setConfigurationProviderId(null)}
      />
    </section>
  );
}
