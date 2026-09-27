use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
pub enum ProviderId {
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "groq")]
    Groq,
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
}

impl ProviderId {
    pub const ALL: [Self; 5] = [
        Self::OpenAi,
        Self::Gemini,
        Self::Anthropic,
        Self::Groq,
        Self::OpenAiCompatible,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Gemini => "gemini",
            Self::Anthropic => "anthropic",
            Self::Groq => "groq",
            Self::OpenAiCompatible => "openai-compatible",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}

impl CommandError {
    pub const fn new(code: &'static str, message: &'static str, retryable: bool) -> Self {
        Self {
            code,
            message,
            retryable,
        }
    }

    pub const fn credential_store() -> Self {
        Self::new(
            "credential_store_unavailable",
            "The operating-system credential store is unavailable.",
            false,
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProbeInput {
    pub provider_id: ProviderId,
    pub model_id: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Connected,
    InvalidCredentials,
    Unauthorized,
    RateLimited,
    NetworkError,
    ProviderError,
    Unsupported,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderErrorCategory {
    InvalidCredentials,
    RateLimit,
    NetworkFailure,
    ProviderOutage,
    InvalidRequest,
    UnsupportedModel,
    ConfigurationError,
    CredentialStore,
    UnknownProviderError,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderError {
    pub code: &'static str,
    pub provider_id: ProviderId,
    pub category: ProviderErrorCategory,
    pub message: &'static str,
    pub retryable: bool,
    pub user_action: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub status: ConnectionStatus,
    pub provider_id: ProviderId,
    pub model_verified: bool,
    pub message: &'static str,
    pub error: Option<ProviderError>,
}

impl ConnectionTestResult {
    pub const fn connected(provider_id: ProviderId) -> Self {
        Self {
            status: ConnectionStatus::Connected,
            provider_id,
            model_verified: true,
            message: "The provider accepted the saved key and selected model.",
            error: None,
        }
    }

    pub const fn failed(
        provider_id: ProviderId,
        status: ConnectionStatus,
        code: &'static str,
        category: ProviderErrorCategory,
        message: &'static str,
        retryable: bool,
        user_action: Option<&'static str>,
    ) -> Self {
        Self {
            status,
            provider_id,
            model_verified: false,
            message,
            error: Some(ProviderError {
                code,
                provider_id,
                category,
                message,
                retryable,
                user_action,
            }),
        }
    }
}
