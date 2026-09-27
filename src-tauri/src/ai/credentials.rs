use keyring::{Entry, Error as KeyringError};
use zeroize::Zeroizing;

use super::types::ProviderId;

const KEYRING_SERVICE: &str = "com.axis.desktop.ai-provider";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialStoreError {
    Missing,
    Unavailable,
}

pub trait CredentialStore: Send + Sync {
    fn save(&self, provider_id: ProviderId, credential: &str) -> Result<(), CredentialStoreError>;
    fn get(&self, provider_id: ProviderId) -> Result<Zeroizing<String>, CredentialStoreError>;
    fn delete(&self, provider_id: ProviderId) -> Result<(), CredentialStoreError>;

    fn has(&self, provider_id: ProviderId) -> Result<bool, CredentialStoreError> {
        match self.get(provider_id) {
            Ok(credential) => {
                drop(credential);
                Ok(true)
            }
            Err(CredentialStoreError::Missing) => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn clear_all(&self) -> Result<(), CredentialStoreError> {
        for provider_id in ProviderId::ALL {
            self.delete(provider_id)?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct OsCredentialStore;

impl OsCredentialStore {
    fn entry(provider_id: ProviderId) -> Result<Entry, CredentialStoreError> {
        Entry::new(KEYRING_SERVICE, provider_id.as_str())
            .map_err(|_| CredentialStoreError::Unavailable)
    }

    fn map_error(error: KeyringError) -> CredentialStoreError {
        match error {
            KeyringError::NoEntry => CredentialStoreError::Missing,
            _ => CredentialStoreError::Unavailable,
        }
    }
}

impl CredentialStore for OsCredentialStore {
    fn save(&self, provider_id: ProviderId, credential: &str) -> Result<(), CredentialStoreError> {
        Self::entry(provider_id)?
            .set_password(credential)
            .map_err(Self::map_error)
    }

    fn get(&self, provider_id: ProviderId) -> Result<Zeroizing<String>, CredentialStoreError> {
        Self::entry(provider_id)?
            .get_password()
            .map(Zeroizing::new)
            .map_err(Self::map_error)
    }

    fn delete(&self, provider_id: ProviderId) -> Result<(), CredentialStoreError> {
        match Self::entry(provider_id)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(Self::map_error(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::Mutex,
    };

    use super::*;

    #[derive(Default)]
    struct MemoryCredentialStore {
        credentials: Mutex<HashMap<ProviderId, String>>,
        fail: bool,
    }

    impl CredentialStore for MemoryCredentialStore {
        fn save(
            &self,
            provider_id: ProviderId,
            credential: &str,
        ) -> Result<(), CredentialStoreError> {
            if self.fail {
                return Err(CredentialStoreError::Unavailable);
            }
            self.credentials
                .lock()
                .expect("credential test mutex poisoned")
                .insert(provider_id, credential.to_owned());
            Ok(())
        }

        fn get(
            &self,
            provider_id: ProviderId,
        ) -> Result<Zeroizing<String>, CredentialStoreError> {
            if self.fail {
                return Err(CredentialStoreError::Unavailable);
            }
            self.credentials
                .lock()
                .expect("credential test mutex poisoned")
                .get(&provider_id)
                .cloned()
                .map(Zeroizing::new)
                .ok_or(CredentialStoreError::Missing)
        }

        fn delete(&self, provider_id: ProviderId) -> Result<(), CredentialStoreError> {
            if self.fail {
                return Err(CredentialStoreError::Unavailable);
            }
            self.credentials
                .lock()
                .expect("credential test mutex poisoned")
                .remove(&provider_id);
            Ok(())
        }
    }

    #[test]
    fn saves_retrieves_reports_and_deletes_credentials() {
        let store = MemoryCredentialStore::default();
        let placeholder = "obvious-test-placeholder-not-a-real-key";

        assert!(!store.has(ProviderId::OpenAi).expect("presence check failed"));
        store
            .save(ProviderId::OpenAi, placeholder)
            .expect("save failed");
        assert!(store.has(ProviderId::OpenAi).expect("presence check failed"));
        assert_eq!(
            store.get(ProviderId::OpenAi).expect("retrieve failed").as_str(),
            placeholder
        );
        store.delete(ProviderId::OpenAi).expect("delete failed");
        assert!(!store.has(ProviderId::OpenAi).expect("presence check failed"));
    }

    #[test]
    fn provider_entries_are_isolated_and_replacement_is_scoped() {
        let store = MemoryCredentialStore::default();
        store
            .save(ProviderId::OpenAi, "fake-openai-secret-test-value")
            .expect("OpenAI save failed");
        store
            .save(ProviderId::Gemini, "fake-gemini-secret-test-value")
            .expect("Gemini save failed");
        store
            .save(ProviderId::OpenAi, "fake-openai-replacement-test-value")
            .expect("OpenAI replacement failed");

        assert_eq!(
            store.get(ProviderId::OpenAi).expect("OpenAI read failed").as_str(),
            "fake-openai-replacement-test-value"
        );
        assert_eq!(
            store.get(ProviderId::Gemini).expect("Gemini read failed").as_str(),
            "fake-gemini-secret-test-value"
        );
        store.delete(ProviderId::OpenAi).expect("OpenAI delete failed");
        assert_eq!(
            store.get(ProviderId::Gemini).expect("Gemini read failed").as_str(),
            "fake-gemini-secret-test-value"
        );
    }

    #[test]
    fn surfaces_store_failures_without_returning_a_secret() {
        let store = MemoryCredentialStore {
            fail: true,
            ..Default::default()
        };
        assert_eq!(
            store.save(ProviderId::Gemini, "obvious-test-placeholder"),
            Err(CredentialStoreError::Unavailable)
        );
        assert_eq!(
            store.get(ProviderId::Gemini).expect_err("store should fail"),
            CredentialStoreError::Unavailable
        );
    }
}
