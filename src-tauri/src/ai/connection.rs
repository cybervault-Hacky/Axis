use std::net::IpAddr;

use reqwest::{StatusCode, Url};
use serde::Deserialize;
use zeroize::Zeroizing;

use super::types::{
    ConnectionProbeInput, ConnectionStatus, ConnectionTestResult, ProviderErrorCategory, ProviderId,
};

const MAX_MODEL_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

fn failure_for_status(provider_id: ProviderId, status: StatusCode) -> ConnectionTestResult {
    match status.as_u16() {
        401 => ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::InvalidCredentials,
            "invalid_credentials",
            ProviderErrorCategory::InvalidCredentials,
            "The provider did not accept this credential.",
            false,
            Some("Replace the API key and test again."),
        ),
        403 => ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::Unauthorized,
            "unauthorized",
            ProviderErrorCategory::InvalidCredentials,
            "The provider account does not permit this request.",
            false,
            Some("Review the key permissions and provider account access."),
        ),
        429 => ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::RateLimited,
            "rate_limited",
            ProviderErrorCategory::RateLimit,
            "The provider is rate limiting connection checks.",
            true,
            Some("Wait briefly before testing again."),
        ),
        500..=599 => ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::ProviderError,
            "provider_error",
            ProviderErrorCategory::ProviderOutage,
            "The provider is currently unavailable.",
            true,
            Some("Try the connection test again later."),
        ),
        _ => ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::ProviderError,
            "invalid_request",
            ProviderErrorCategory::InvalidRequest,
            "The provider rejected the connection check.",
            false,
            Some("Review the endpoint, model, and account configuration."),
        ),
    }
}

fn custom_models_url(base_url: Option<&str>) -> Result<Url, &'static str> {
    let base_url = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("A custom API base URL is required.")?;
    if base_url.len() > 2_048 {
        return Err("The custom API base URL is longer than the supported limit.");
    }
    let parsed = Url::parse(base_url).map_err(|_| "The custom API base URL is invalid.")?;
    let authority = base_url
        .split_once("://")
        .map(|(_, remainder)| remainder.split(['/', '?', '#']).next().unwrap_or(""))
        .unwrap_or("");
    if parsed.username() != "" || parsed.password().is_some() || authority.contains('@') {
        return Err("Credentials are not allowed in the custom endpoint URL.");
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("The custom endpoint cannot include a query or fragment.");
    }

    let host = parsed
        .host_str()
        .ok_or("The custom API base URL requires a host.")?;
    let normalized_host = host.trim_start_matches('[').trim_end_matches(']');
    let loopback = host.eq_ignore_ascii_case("localhost")
        || normalized_host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err("Custom endpoints must use HTTPS unless they are loopback addresses.");
    }

    Url::parse(&format!("{}/models", base_url.trim_end_matches('/')))
        .map_err(|_| "The custom models endpoint could not be created.")
}

fn provider_models_url(input: &ConnectionProbeInput) -> Result<Url, &'static str> {
    let fixed_url = match input.provider_id {
        ProviderId::OpenAi => Some("https://api.openai.com/v1/models"),
        ProviderId::Gemini => Some("https://generativelanguage.googleapis.com/v1beta/models"),
        ProviderId::Anthropic => Some("https://api.anthropic.com/v1/models"),
        ProviderId::Groq => Some("https://api.groq.com/openai/v1/models"),
        ProviderId::OpenAiCompatible => None,
    };

    match fixed_url {
        Some(url) => Url::parse(url).map_err(|_| "The provider endpoint is invalid."),
        None => custom_models_url(input.base_url.as_deref()),
    }
}

#[derive(Debug, Deserialize)]
struct ModelCatalog {
    #[serde(default)]
    data: Vec<ModelCatalogEntry>,
    #[serde(default)]
    models: Vec<ModelCatalogEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelCatalogEntry {
    id: Option<String>,
    name: Option<String>,
}

fn model_ids(provider_id: ProviderId, catalog: &ModelCatalog) -> Vec<&str> {
    if provider_id == ProviderId::Gemini {
        return catalog
            .models
            .iter()
            .filter_map(|model| model.name.as_deref())
            .map(|name| name.strip_prefix("models/").unwrap_or(name))
            .collect();
    }

    catalog
        .data
        .iter()
        .filter_map(|model| model.id.as_deref())
        .collect()
}

pub async fn probe_connection(
    client: &reqwest::Client,
    input: &ConnectionProbeInput,
    credential: &Zeroizing<String>,
) -> ConnectionTestResult {
    let provider_id = input.provider_id;
    let model_id = input.model_id.trim();
    if model_id.is_empty() || model_id.len() > 200 {
        return ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::ProviderError,
            "configuration_error",
            ProviderErrorCategory::ConfigurationError,
            "Choose a valid model before testing the connection.",
            false,
            Some("Review the selected model ID."),
        );
    }

    let url = match provider_models_url(input) {
        Ok(url) => url,
        Err(message) => {
            return ConnectionTestResult::failed(
                provider_id,
                ConnectionStatus::ProviderError,
                "configuration_error",
                ProviderErrorCategory::ConfigurationError,
                message,
                false,
                Some("Review the custom endpoint configuration."),
            );
        }
    };

    let request = match provider_id {
        ProviderId::Gemini => client.get(url).header("x-goog-api-key", credential.as_str()),
        ProviderId::Anthropic => client
            .get(url)
            .header("x-api-key", credential.as_str())
            .header("anthropic-version", "2023-06-01"),
        ProviderId::OpenAi | ProviderId::Groq | ProviderId::OpenAiCompatible => {
            client.get(url).bearer_auth(credential.as_str())
        }
    };

    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            let (code, message, retryable) = if error.is_timeout() {
                (
                    "network_error",
                    "The provider connection timed out.",
                    true,
                )
            } else if error.is_connect() {
                (
                    "network_error",
                    "AXIS could not reach the provider endpoint.",
                    true,
                )
            } else {
                (
                    "unknown_error",
                    "The provider connection could not be verified.",
                    false,
                )
            };
            return ConnectionTestResult::failed(
                provider_id,
                ConnectionStatus::NetworkError,
                code,
                ProviderErrorCategory::NetworkFailure,
                message,
                retryable,
                Some("Check network access and the configured endpoint."),
            );
        }
    };

    let status = response.status();
    if !status.is_success() {
        return failure_for_status(provider_id, status);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_RESPONSE_BYTES as u64)
    {
        return ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::ProviderError,
            "provider_error",
            ProviderErrorCategory::ProviderOutage,
            "The provider returned an unexpectedly large model catalog.",
            false,
            Some("Review the endpoint configuration."),
        );
    }

    let mut body = Zeroizing::new(Vec::new());
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if chunk.len() <= MAX_MODEL_RESPONSE_BYTES - body.len() => {
                body.extend_from_slice(&chunk);
            }
            Ok(Some(_)) | Err(_) => {
                return ConnectionTestResult::failed(
                    provider_id,
                    ConnectionStatus::ProviderError,
                    "provider_error",
                    ProviderErrorCategory::ProviderOutage,
                    "The provider model catalog could not be read safely.",
                    false,
                    Some("Try again or review the endpoint configuration."),
                );
            }
            Ok(None) => break,
        }
    }
    let catalog: ModelCatalog = match serde_json::from_slice(body.as_slice()) {
        Ok(value) => value,
        Err(_) => {
            return ConnectionTestResult::failed(
                provider_id,
                ConnectionStatus::ProviderError,
                "provider_error",
                ProviderErrorCategory::ProviderOutage,
                "The provider returned an unsupported model catalog.",
                false,
                Some("Confirm that the endpoint implements the provider model API."),
            );
        }
    };

    if model_ids(provider_id, &catalog)
        .iter()
        .any(|candidate| *candidate == model_id)
    {
        ConnectionTestResult::connected(provider_id)
    } else {
        ConnectionTestResult::failed(
            provider_id,
            ConnectionStatus::Unsupported,
            "unsupported_model",
            ProviderErrorCategory::UnsupportedModel,
            "The selected model is not available for this provider account.",
            false,
            Some("Choose another model and test again."),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_http_connection_states() {
        assert!(matches!(
            failure_for_status(ProviderId::OpenAi, StatusCode::UNAUTHORIZED).status,
            ConnectionStatus::InvalidCredentials
        ));
        assert!(matches!(
            failure_for_status(ProviderId::OpenAi, StatusCode::FORBIDDEN).status,
            ConnectionStatus::Unauthorized
        ));
        assert!(matches!(
            failure_for_status(ProviderId::OpenAi, StatusCode::TOO_MANY_REQUESTS).status,
            ConnectionStatus::RateLimited
        ));
        assert!(matches!(
            failure_for_status(ProviderId::OpenAi, StatusCode::BAD_GATEWAY).status,
            ConnectionStatus::ProviderError
        ));
    }

    #[test]
    fn extracts_provider_model_catalogs() {
        let openai: ModelCatalog = serde_json::from_str(r#"{"data":[{"id":"model-one"}]}"#)
            .expect("valid OpenAI catalog");
        let gemini: ModelCatalog = serde_json::from_str(
            r#"{"models":[{"name":"models/model-two"}]}"#,
        )
        .expect("valid Gemini catalog");
        assert_eq!(model_ids(ProviderId::OpenAi, &openai), vec!["model-one"]);
        assert_eq!(model_ids(ProviderId::Gemini, &gemini), vec!["model-two"]);
    }

    #[test]
    fn custom_endpoints_require_https_except_for_loopback() {
        assert!(custom_models_url(Some("https://provider.example/v1")).is_ok());
        assert!(custom_models_url(Some("http://localhost:11434/v1")).is_ok());
        assert!(custom_models_url(Some("http://[::1]:8080/v1")).is_ok());
        assert!(custom_models_url(Some("http://192.0.2.10/v1")).is_err());
        assert!(custom_models_url(Some("https://user:pass@provider.example/v1")).is_err());
        assert!(custom_models_url(Some("https://user@provider.example/v1")).is_err());
        assert!(custom_models_url(Some("https://@provider.example/v1")).is_err());
        assert!(custom_models_url(Some("https://provider.example/v1?token=fake")).is_err());
        assert!(custom_models_url(Some("https://provider.example/v1#fragment")).is_err());
        assert!(custom_models_url(Some("not a URL")).is_err());
        let oversized = format!("https://provider.example/{}", "a".repeat(2_048));
        assert!(custom_models_url(Some(&oversized)).is_err());
    }
}
