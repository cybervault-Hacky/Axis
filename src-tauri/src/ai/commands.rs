use tauri::State;
use zeroize::{Zeroize, Zeroizing};

use super::{
    connection::probe_connection,
    credentials::CredentialStoreError,
    types::{
        CommandError, ConnectionProbeInput, ConnectionStatus, ConnectionTestResult,
        ProviderErrorCategory, ProviderId,
    },
    AiRuntime,
};

fn map_store_error(_: CredentialStoreError) -> CommandError {
    CommandError::credential_store()
}

#[tauri::command]
pub fn save_ai_credential(
    state: State<'_, AiRuntime>,
    provider_id: ProviderId,
    mut credential: String,
) -> Result<(), CommandError> {
    let normalized = Zeroizing::new(credential.trim().to_owned());
    credential.zeroize();
    if normalized.len() < 8
        || normalized.len() > 2_048
        || normalized.chars().any(char::is_whitespace)
        || normalized.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "invalid_credential",
            "Enter a valid provider credential.",
            false,
        ));
    }

    state
        .credentials
        .save(provider_id, normalized.as_str())
        .map_err(map_store_error)
}

#[tauri::command]
pub fn has_ai_credential(
    state: State<'_, AiRuntime>,
    provider_id: ProviderId,
) -> Result<bool, CommandError> {
    state.credentials.has(provider_id).map_err(map_store_error)
}

#[tauri::command]
pub fn delete_ai_credential(
    state: State<'_, AiRuntime>,
    provider_id: ProviderId,
) -> Result<(), CommandError> {
    state
        .credentials
        .delete(provider_id)
        .map_err(map_store_error)
}

#[tauri::command]
pub fn clear_all_ai_credentials(state: State<'_, AiRuntime>) -> Result<(), CommandError> {
    state.credentials.clear_all().map_err(map_store_error)
}

#[tauri::command]
pub async fn test_ai_provider_connection(
    state: State<'_, AiRuntime>,
    input: ConnectionProbeInput,
) -> Result<ConnectionTestResult, CommandError> {
    let credential = match state.credentials.get(input.provider_id) {
        Ok(credential) => credential,
        Err(CredentialStoreError::Missing) => {
            return Ok(ConnectionTestResult::failed(
                input.provider_id,
                ConnectionStatus::InvalidCredentials,
                "missing_credential",
                ProviderErrorCategory::InvalidCredentials,
                "Save an API key before testing this provider.",
                false,
                Some("Enter and save a provider API key."),
            ));
        }
        Err(CredentialStoreError::Unavailable) => {
            return Ok(ConnectionTestResult::failed(
                input.provider_id,
                ConnectionStatus::Unavailable,
                "credential_store_unavailable",
                ProviderErrorCategory::CredentialStore,
                "The operating-system credential store is unavailable.",
                false,
                Some("Run AXIS in its native desktop shell and check the OS credential service."),
            ));
        }
    };

    Ok(probe_connection(&state.client, &input, &credential).await)
}
