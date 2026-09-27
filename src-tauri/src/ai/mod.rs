mod commands;
mod connection;
mod credentials;
mod types;

use std::{sync::Arc, time::Duration};

use credentials::{CredentialStore, OsCredentialStore};

pub use commands::{
    clear_all_ai_credentials, delete_ai_credential, has_ai_credential, save_ai_credential,
    test_ai_provider_connection,
};

pub struct AiRuntime {
    credentials: Arc<dyn CredentialStore>,
    client: reqwest::Client,
}

impl AiRuntime {
    pub fn new() -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .user_agent("AXIS/0.4.0")
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            credentials: Arc::new(OsCredentialStore),
            client,
        })
    }
}
