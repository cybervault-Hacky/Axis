import { useId } from "react";
import type { AIModelCapability, AIProviderDefinition } from "../domain/types";

const capabilityLabels: Record<AIModelCapability, string> = {
  text: "Text",
  "image-input": "Images",
  "audio-input": "Audio",
  "video-input": "Video",
  "structured-output": "Structured output",
  "tool-calling": "Tool-ready",
  streaming: "Streaming-ready",
};

interface ModelSelectorProps {
  provider: AIProviderDefinition;
  value: string | null;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({
  provider,
  value,
  onChange,
  disabled = false,
}: ModelSelectorProps) {
  const inputId = useId();
  const descriptionId = useId();
  const selectedModel = provider.models.find((model) => model.id === value);

  if (provider.customModel) {
    return (
      <div className="provider-form-field">
        <label htmlFor={inputId}>Model ID</label>
        <input
          id={inputId}
          className="provider-text-input"
          type="text"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter the endpoint model ID"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={200}
          disabled={disabled}
          aria-describedby={descriptionId}
        />
        <p id={descriptionId} className="provider-field-note">
          Use the exact model identifier exposed by your compatible endpoint.
        </p>
      </div>
    );
  }

  return (
    <div className="provider-form-field">
      <label htmlFor={inputId}>Model</label>
      <select
        id={inputId}
        className="provider-select"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-describedby={descriptionId}
      >
        <option value="" disabled>Choose a model</option>
        {provider.models.map((model) => (
          <option
            key={model.id}
            value={model.id}
            disabled={model.availability === "unavailable"}
          >
            {model.displayName}
            {model.availability === "unavailable" ? " — unavailable" : ""}
          </option>
        ))}
      </select>
      <div id={descriptionId} className="model-selection-detail" aria-live="polite">
        {selectedModel ? (
          <>
            <p>{selectedModel.description}</p>
            <div className="model-capabilities" aria-label="Model capabilities">
              {selectedModel.capabilities.map((capability) => (
                <span key={capability}>{capabilityLabels[capability]}</span>
              ))}
            </div>
            <small>Catalog option. Account access is verified only by a connection test.</small>
          </>
        ) : (
          <p>Choose a catalog model to verify against your provider account.</p>
        )}
      </div>
    </div>
  );
}
