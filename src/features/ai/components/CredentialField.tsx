import { Check, Eye, EyeOff, KeyRound, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Spinner } from "../../../components/ui/Spinner";
import { AIProviderOperationError } from "../domain/errors";
import { validateCredentialInput } from "../security/credentialValidation";

interface CredentialFieldProps {
  label: string;
  configured: boolean;
  backendAvailable: boolean;
  onSave: (credential: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function CredentialField({
  label,
  configured,
  backendAvailable,
  onSave,
  onDelete,
}: CredentialFieldProps) {
  const [credential, setCredential] = useState("");
  const [visible, setVisible] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [operation, setOperation] = useState<"idle" | "saving" | "deleting">("idle");
  const [feedback, setFeedback] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);
  const busy = operation !== "idle";

  const save = async () => {
    const validation = validateCredentialInput(credential);
    if (!validation.valid) {
      setFeedback({ tone: "error", message: validation.message });
      return;
    }

    setOperation("saving");
    setFeedback(null);
    try {
      await onSave(credential);
      setReplacing(false);
      setVisible(false);
      setFeedback({ tone: "success", message: "API key saved to the native credential store." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof AIProviderOperationError
            ? error.normalized.message
            : "The API key could not be saved.",
      });
    } finally {
      setCredential("");
      setOperation("idle");
    }
  };

  const remove = async () => {
    setOperation("deleting");
    setFeedback(null);
    try {
      await onDelete();
      setReplacing(false);
      setCredential("");
      setFeedback({ tone: "success", message: "The saved API key was removed." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof AIProviderOperationError
            ? error.normalized.message
            : "The saved API key could not be removed.",
      });
    } finally {
      setOperation("idle");
    }
  };

  return (
    <div className="provider-form-field provider-credential-field">
      <div className="provider-field-label-row">
        <label htmlFor="provider-api-key">{label}</label>
        <span>BYOK</span>
      </div>

      {configured && !replacing ? (
        <div className="saved-credential">
          <span className="saved-credential__icon" aria-hidden="true">
            <KeyRound size={16} />
          </span>
          <span className="saved-credential__value" aria-label="API key saved and hidden">
            ••••••••••••••••••••••••
          </span>
          <span className="saved-credential__state">
            <Check size={13} aria-hidden="true" />Saved
          </span>
          <Button
            variant="quiet"
            size="small"
            onClick={() => {
              setReplacing(true);
              setFeedback(null);
            }}
            disabled={busy || !backendAvailable}
          >
            Replace
          </Button>
          <Button
            variant="quiet"
            size="icon"
            onClick={() => void remove()}
            disabled={busy || !backendAvailable}
            aria-label="Remove saved API key"
          >
            {operation === "deleting" ? <Spinner label="Removing API key" /> : <Trash2 size={15} />}
          </Button>
        </div>
      ) : (
        <div className="credential-entry">
          <div className="secure-input-wrap">
            <KeyRound size={16} aria-hidden="true" />
            <input
              id="provider-api-key"
              type={visible ? "text" : "password"}
              value={credential}
              onChange={(event) => {
                setCredential(event.target.value);
                setFeedback(null);
              }}
              placeholder="Paste your API key"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy || !backendAvailable}
              aria-invalid={feedback?.tone === "error" || undefined}
            />
            {credential && (
              <button
                type="button"
                className="secure-input-action"
                onClick={() => setCredential("")}
                disabled={busy}
                aria-label="Clear API key"
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="secure-input-action"
              onClick={() => setVisible((current) => !current)}
              disabled={busy || !backendAvailable}
              aria-label={visible ? "Hide API key" : "Show API key"}
              aria-pressed={visible}
            >
              {visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            </button>
          </div>
          <div className="credential-entry__actions">
            {configured && (
              <Button
                variant="quiet"
                size="small"
                onClick={() => {
                  setReplacing(false);
                  setCredential("");
                  setFeedback(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              size="small"
              onClick={() => void save()}
              disabled={!credential || busy || !backendAvailable}
              leadingIcon={operation === "saving" ? <Spinner label="Saving API key" /> : undefined}
            >
              {configured ? "Replace key" : "Save key"}
            </Button>
          </div>
        </div>
      )}

      {!backendAvailable && (
        <p className="provider-security-note provider-security-note--warning" role="status">
          Secure storage is unavailable in this browser preview. Use the native AXIS desktop runtime.
        </p>
      )}
      {backendAvailable && (
        <p className="provider-security-note">
          The key is sent directly to a narrow Tauri command and is never stored in browser storage.
        </p>
      )}
      {feedback && (
        <p
          className={`provider-field-feedback provider-field-feedback--${feedback.tone}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
