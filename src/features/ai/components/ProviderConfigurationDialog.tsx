import { CheckCircle2, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Dialog } from "../../../components/ui/Dialog";
import { Spinner } from "../../../components/ui/Spinner";
import { useNotifications } from "../../notifications/NotificationProvider";
import type { AIProviderId } from "../domain/types";
import { aiProviderRegistry } from "../providers/registry";
import { validateProviderBaseUrl } from "../security/providerEndpointValidation";
import { useAIProviders } from "../state/AIProviderProvider";
import { CredentialField } from "./CredentialField";
import { ModelSelector } from "./ModelSelector";
import { ProviderStatus } from "./ProviderStatus";
import { connectionStatusPresentation } from "./providerStatusPresentation";

interface ProviderConfigurationDialogProps {
  providerId: AIProviderId | null;
  open: boolean;
  onClose: () => void;
}

export function ProviderConfigurationDialog({
  providerId,
  open,
  onClose,
}: ProviderConfigurationDialogProps) {
  const {
    preferences,
    providerStates,
    credentialBackendAvailable,
    selectModel,
    setBaseUrl,
    saveCredential,
    deleteCredential,
    testConnection,
  } = useAIProviders();
  const { notify } = useNotifications();
  const [localError, setLocalError] = useState<string | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);

  if (!providerId) return null;

  const provider = aiProviderRegistry.get(providerId);
  const config = preferences.configs[providerId];
  const runtime = providerStates[providerId];
  const status = connectionStatusPresentation[runtime.connectionStatus];
  const testing = runtime.connectionStatus === "testing";
  const customConfigurationReady =
    !provider.customEndpoint || Boolean(config.baseUrl?.trim());
  const canTest =
    runtime.credentialConfigured &&
    Boolean(config.selectedModelId?.trim()) &&
    customConfigurationReady &&
    credentialBackendAvailable &&
    !testing;

  const runTest = async () => {
    setLocalError(null);
    try {
      const result = await testConnection(providerId);
      if (result.status === "connected") {
        notify({
          tone: "success",
          title: `${provider.shortName} connected`,
          message: "The saved key and selected model were verified for this session.",
        });
      }
    } catch {
      setLocalError("The connection check could not be started.");
    }
  };

  const closeDialog = () => {
    setLocalError(null);
    setEndpointError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      className="dialog--provider"
      title={`Configure ${provider.displayName}`}
      description="Your provider powers AXIS, while AXIS remains in control of the workflow."
      footer={
        <>
          <Button variant="quiet" onClick={closeDialog}>Close</Button>
          <Button
            variant="primary"
            onClick={() => void runTest()}
            disabled={!canTest}
            leadingIcon={
              testing
                ? <Spinner label="Testing provider connection" />
                : <RefreshCw size={15} aria-hidden="true" />
            }
          >
            {testing ? "Testing connection" : "Test connection"}
          </Button>
        </>
      }
    >
      <div className="provider-config-dialog">
        <div className="provider-config-summary">
          <span className="provider-config-summary__mark" aria-hidden="true">
            {provider.shortName.slice(0, 1)}
          </span>
          <span>
            <strong>{provider.displayName}</strong>
            <small>{provider.description}</small>
          </span>
          <ProviderStatus status={runtime.connectionStatus} />
        </div>

        <div className="provider-config-section">
          <div className="provider-config-section__heading">
            <span><Server size={16} aria-hidden="true" /></span>
            <div>
              <h3>Provider configuration</h3>
              <p>Select the model AXIS should use after generation is enabled in a future phase.</p>
            </div>
          </div>

          {provider.customEndpoint && (
            <div className="provider-form-field">
              <label htmlFor="provider-base-url">API base URL</label>
              <input
                key={providerId}
                id="provider-base-url"
                className="provider-text-input"
                type="url"
                defaultValue={config.baseUrl ?? ""}
                onChange={() => setEndpointError(null)}
                onBlur={(event) => {
                  const validation = validateProviderBaseUrl(event.target.value);
                  if (!validation.valid) {
                    setEndpointError(validation.message);
                    return;
                  }
                  setEndpointError(null);
                  setBaseUrl(providerId, validation.value);
                }}
                placeholder="https://your-endpoint.example/v1"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={2048}
                disabled={testing}
                aria-invalid={Boolean(endpointError) || undefined}
                aria-describedby="provider-base-url-note"
              />
              <p id="provider-base-url-note" className="provider-field-note">
                HTTPS is required except for loopback endpoints such as localhost.
              </p>
              {endpointError && (
                <p className="provider-field-feedback provider-field-feedback--error" role="alert">
                  {endpointError}
                </p>
              )}
            </div>
          )}

          <ModelSelector
            provider={provider}
            value={config.selectedModelId}
            onChange={(modelId) => selectModel(providerId, modelId)}
            disabled={testing}
          />
        </div>

        <div className="provider-config-section">
          <div className="provider-config-section__heading">
            <span><ShieldCheck size={16} aria-hidden="true" /></span>
            <div>
              <h3>Credential</h3>
              <p>AXIS stores provider keys behind its native credential boundary.</p>
            </div>
          </div>

          <CredentialField
            label={provider.credentialLabel}
            configured={runtime.credentialConfigured}
            backendAvailable={credentialBackendAvailable}
            onSave={(credential) => saveCredential(providerId, credential)}
            onDelete={() => deleteCredential(providerId)}
          />
        </div>

        <div
          className={`provider-connection-result provider-connection-result--${runtime.connectionStatus}`}
          role={runtime.error ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="provider-connection-result__icon" aria-hidden="true">
            {runtime.connectionStatus === "connected"
              ? <CheckCircle2 size={18} />
              : testing
                ? <Spinner size="medium" label="Connection test in progress" />
                : <RefreshCw size={17} />}
          </span>
          <div>
            <div className="provider-connection-result__title">
              <strong>{status.label}</strong>
              {runtime.lastTestedAt && <span>Tested this session</span>}
            </div>
            <p>{runtime.error?.message ?? status.detail}</p>
            {runtime.error?.userAction && <small>{runtime.error.userAction}</small>}
            {localError && <small>{localError}</small>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
