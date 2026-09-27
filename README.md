# AXIS

**One AI. Every tool.**

AXIS is a desktop control surface for coordinating AI-assisted work across professional applications. This repository contains **Phase 4: Secure Credential Management & Secret Lifecycle**, building on the Phase 3 provider system and BYOK foundation.

The current application supports provider setup and real connection checks. It does **not** execute prompts, tools, agents, workflows, or external-application actions. AXIS does not fabricate AI output, provider access, usage, activity, points, or billing.

## Phase 4 capabilities

- A single frontend `CredentialService` and a narrow native credential-store boundary
- OS-backed credential persistence through Rust `keyring`, with no plaintext or browser-storage fallback
- Strongly typed, provider-scoped credential commands; there is no command to return a saved credential to the frontend
- Add, replace, presence-check, connection-test, and remove flows with safe provider status updates
- Provider replacement does not reveal or copy out the previously saved value
- Input secrets are discarded from the credential field on successful or failed save and when the dialog closes or changes provider
- Safe, recursive redaction for named credential fields, authorization schemes, common token values, nested objects, arrays, errors, and URL user-info
- Native connection checks with a 15-second request timeout, redirects disabled, bounded response size, and normalized errors
- Custom OpenAI-compatible endpoints restricted to HTTPS, except loopback HTTP; user-info, query parameters, fragments, malformed URLs, and oversized URLs are rejected
- Version metadata synchronized to **v0.4.0**

## Providers

All providers use the same normalized AXIS architecture. Catalog entries are configuration candidates; a successful native connection test is still required to establish actual account and model access.

| Provider ID | Provider | Authentication used by the native probe |
| --- | --- | --- |
| `openai` | OpenAI | Bearer authorization header |
| `gemini` | Google Gemini | `x-goog-api-key` header |
| `anthropic` | Anthropic Claude | `x-api-key` plus Anthropic version header |
| `groq` | Groq | Bearer authorization header |
| `openai-compatible` | Custom endpoint | Bearer authorization header |

AXIS currently has one OpenAI-compatible custom-provider configuration and one separate credential scope for it. Multiple custom endpoint profiles are not yet supported. The custom connection probe only requests the model catalog path; AXIS does not expose a general-purpose fetch command to the frontend.

## BYOK and credential security

### Authority and lifecycle

The frontend `CredentialService` is the sole browser-side credential authority. It only exposes save, presence, delete, and clear operations. The native `CredentialStore` abstraction owns OS-store access and only the provider connection probe can retrieve a saved credential internally. Provider IDs are validated by the TypeScript service and decoded into a closed Rust enum at the Tauri boundary. A credential for one provider cannot be selected by another provider's command.

The normal path is:

```text
Password input → scoped Tauri save command → OS credential store
OS credential store → scoped native provider probe → provider auth header
```

The raw value is briefly present in the input's React state and the save command argument while a new value is being stored. The input is cleared after the operation, and unmounts when the dialog closes or the selected provider changes. Connection testing does not send a stored secret through React state or return it from native storage. There is no command to reveal or export a saved value.

Replacing a credential writes the new value to the same provider-scoped OS entry without reading the old value back. A failed provider validation does not delete a credential. Removing an entry reports native deletion failures rather than claiming success. After successful removal, the provider's configured and connection state is reset immediately.

### Native storage and platform limits

The native implementation uses the Rust `keyring` crate with explicitly selected platform backends:

- macOS: native Keychain backend;
- Windows: native Credential Manager backend; and
- Linux: persistent native credential-service backend, requiring an available supported desktop credential service.

The application does not silently fall back to `localStorage`, `sessionStorage`, IndexedDB, plaintext files, or frontend encryption. If the OS store is unavailable, the operation fails and the UI explains that secure storage is unavailable. In a browser-only development preview, credential entry is disabled.

Rust-owned secret buffers use `zeroize` where practical. This is best-effort hygiene for buffers AXIS controls, not a guarantee that every copy inside the runtime, OS, or HTTP stack is erased.

### Safe persisted state

Only validated, non-secret provider preferences are written to `axis:ai-provider-preferences`:

- selected provider ID;
- provider enabled state;
- selected model ID; and
- validated custom API base URL.

Credential presence, connection status, test errors, request data, activity events, usage, and generated content are runtime-only and are not written to provider preferences. Theme and sidebar preferences remain stored separately. Connection validation and credential mutations do not create Activity records in this phase.

### Custom endpoint boundaries

Custom endpoint validation occurs in the frontend and is repeated at the native boundary. Remote HTTP, URL-embedded credentials, query parameters, fragments, malformed URLs, and excessive URL lengths are rejected. HTTP is permitted only for loopback addresses such as `localhost` and loopback IPs. Authentication is sent in an HTTP header, never in the endpoint URL. Redirects are disabled to avoid forwarding credentials to a redirect target.

A user-configured HTTPS endpoint is contacted by the native connection probe at its model-catalog path. As with any user-entered endpoint, the owner should only configure a host they trust. AXIS does not provide arbitrary URL, shell, filesystem, or general network commands.

### Redaction and errors

Provider and credential errors are normalized to concise, user-facing categories. The shared redactor covers sensitive property names, common authorization forms, token/key assignments, provider-specific key patterns, nested values, arrays, URL user-info, and error causes. Error stack traces are omitted from redacted serialization. There are no credential-related debug or console logs in the application.

Redaction is defense in depth, not a substitute for avoiding secret-bearing diagnostics. AXIS does not send credentials in URLs, notifications, Activity, analytics, telemetry, or persisted provider state.

## Architecture

The provider implementation lives under `src/features/ai/`:

- `domain/` — normalized contracts, safe errors, and request/response normalization;
- `providers/` — validated registry, provider adapters, and `AIProviderManager`;
- `services/` — the canonical frontend credential service and narrow native connection gateway;
- `security/` — credential and endpoint validation plus redaction;
- `state/` — safe preference parsing/persistence and runtime provider state; and
- `components/` — provider cards, model selection, credential controls, statuses, and configuration dialog.

The native implementation lives under `src-tauri/src/ai/`. It owns OS credential access, provider-scope validation, endpoint validation, scoped HTTP connection probes, and normalized command responses. The Tauri capability configuration stays least-privilege; there is no generic shell or filesystem plugin/bridge.

Adapters expose normalized request and streaming contracts for future Agent Engine integration. AI generation and streaming remain disabled; connection testing is the only supported provider network operation.

## Not implemented

- AI generation or chat responses;
- agents, autonomous execution, or an Agent Engine runtime;
- tool invocation, shell/Python execution, or computer control;
- app connectors or external-application actions;
- workflow execution, project execution, or credential Activity records;
- billing, subscriptions, points, or a marketplace; and
- cloud credential storage, account sync, or credential export.

The Home composer remains non-executing and does not transmit its text to a provider.

## Technology

- [Tauri 2](https://tauri.app/) and Rust
- React 19 and strict TypeScript
- Vite and React Router
- Rust `keyring`, `reqwest`, and `zeroize`
- Lucide SVG icons and a CSS design-token system
- Vitest and Testing Library

## Local development

### Prerequisites

- Node.js 20 or newer
- Rust 1.88 or newer
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system
- A usable OS credential service for native BYOK persistence

Install the locked frontend dependencies and start the desktop app:

```bash
npm ci
npm run tauri:dev
```

For frontend-only interface development:

```bash
npm run dev
```

Vite serves the interface at `http://localhost:1420`. Provider credentials cannot be configured in that browser-only view because no insecure web-storage fallback exists.

## Verification

Run the frontend quality suite:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=low
```

Or run the first four checks together:

```bash
npm run check
```

When Rust and platform prerequisites are installed, validate the native project too:

```bash
npm run tauri -- info
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
npm run tauri:build -- --debug
```

## Production desktop build

```bash
npm run tauri:build
```

Tauri writes native output under `src-tauri/target/`. Native compilation and packaging require the OS libraries documented by Tauri; Linux additionally needs the appropriate WebKitGTK development packages and a supported credential service at runtime.

## Environment files

`.env.example` contains public, non-secret build-time metadata only. Never place API keys or credentials in `VITE_` variables: Vite exposes those values to the frontend bundle. Local `.env` variants and common credential/config files are ignored by Git.
