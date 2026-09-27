import { Check, ChevronRight, KeyRound } from "lucide-react";
import { ProviderStatus } from "./ProviderStatus";
import type {
  AIProviderConfig,
  AIProviderDefinition,
  AIProviderRuntimeState,
} from "../domain/types";

interface ProviderCardProps {
  provider: AIProviderDefinition;
  config: AIProviderConfig;
  runtime: AIProviderRuntimeState;
  selected: boolean;
  onConfigure: () => void;
}

export function ProviderCard({
  provider,
  config,
  runtime,
  selected,
  onConfigure,
}: ProviderCardProps) {
  const model = provider.models.find((candidate) => candidate.id === config.selectedModelId);
  const modelLabel = provider.customModel
    ? config.selectedModelId || "Model ID required"
    : model?.displayName ?? "Choose a model";

  return (
    <button
      className="provider-choice-card"
      data-selected={selected || undefined}
      type="button"
      onClick={onConfigure}
      aria-label={`Configure ${provider.displayName}`}
    >
      <span className="provider-choice-card__mark" aria-hidden="true">
        {provider.shortName.slice(0, 1)}
      </span>
      <span className="provider-choice-card__body">
        <span className="provider-choice-card__title-row">
          <strong>{provider.displayName}</strong>
          {selected && (
            <span className="provider-choice-card__selected">
              <Check size={12} aria-hidden="true" />Selected
            </span>
          )}
        </span>
        <span className="provider-choice-card__description">{provider.description}</span>
        <span className="provider-choice-card__model">{modelLabel}</span>
      </span>
      <span className="provider-choice-card__meta">
        <ProviderStatus status={runtime.connectionStatus} />
        <span className="provider-choice-card__credential">
          <KeyRound size={13} aria-hidden="true" />
          {runtime.credentialConfigured ? "Key saved" : "No key"}
        </span>
      </span>
      <ChevronRight className="provider-choice-card__chevron" size={17} aria-hidden="true" />
    </button>
  );
}
