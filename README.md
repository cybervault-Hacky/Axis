# AXIS

**One AI. Every tool.**

AXIS is a desktop control surface for coordinating AI-assisted work across professional applications. This repository contains **Phase 3: AI Provider System + Bring Your Own Key (BYOK)**.

Phase 3 establishes a secure, vendor-neutral provider foundation and real connection verification. It does **not** execute prompts, tools, agents, workflows, or external-application actions. Unsupported capabilities stay visibly unavailable; AXIS does not fabricate AI output, provider access, usage, activity, points, or billing.

## Phase 3 capabilities

- Tauri 2 desktop shell with a custom title bar, native window controls, and least-privilege capabilities
- React 19, strict TypeScript, Vite, and hash-based desktop routing
- Normalized AI provider, model, request, response, error, usage, streaming-event, cancellation, and future tool-definition contracts
- Central provider registry and provider-specific adapters behind an `AIProviderManager`
- Dedicated provider state that separates safe preferences, credential presence, connection state, request state, and usage metadata
- BYOK configuration for saving, replacing, removing, and checking the presence of provider credentials
- Real provider connection probes through a narrow native command; browser preview never simulates success
- Safe selected-provider, selected-model, enabled-state, and custom-base-URL persistence
- Recursive secret redaction for provider keys, bearer tokens, authorization headers, nested secret fields, and errors
- Premium responsive AI overview, provider configuration dialog, Settings integration, and provider context on Home
- Keyboard navigation, dialog focus trapping/restoration, status announcements, visible focus, reduced motion, and dark/light themes
- Preserved Phase 2 app shell, command palette, navigation, settings, and non-executing command composer

## Providers

All providers use the same normalized AXIS architecture. Catalog entries are configuration candidates; a successful native connection test is still required to establish actual account and model access.

| Provider ID | Provider | Catalog choices in Phase 3 | Authentication used by the native probe |
| --- | --- | --- | --- |
| `openai` | OpenAI | `gpt-5.4-mini`, `gpt-5.4` | Bearer header |
| `gemini` | Google Gemini | `gemini-3.7-flash`, `gemini-3.1-flash-lite` | `x-goog-api-key` header |
| `anthropic` | Anthropic Claude | `claude-sonnet-5`, `claude-opus-5` | `x-api-key` plus Anthropic version header |
| `groq` | Groq | `llama-3.3-70b-versatile`, `openai/gpt-oss-120b` | Bearer header |
| `openai-compatible` | Custom endpoint | User-supplied model ID | Bearer header |

Custom endpoints are limited to an OpenAI-compatible model-catalog probe. They must use HTTPS, except for HTTP loopback addresses such as `localhost`; embedded credentials, URL queries, and fragments are rejected. AXIS does not expose an arbitrary native fetch bridge.

## BYOK and credential security

Provider keys cross a narrow Tauri boundary with only these operations:

- save a credential for one registered provider;
- report whether a credential exists;
- delete one provider credential;
- clear all registered provider credentials; and
- test a registered provider connection.

There is intentionally no command that returns a saved key to the frontend. After saving, the UI displays only presence metadata and a static mask; it never reloads or redisplays the raw secret.

Native storage uses the Rust `keyring` crate with explicit platform backends:

- macOS: native Keychain backend;
- Windows: native Credential Manager backend; and
- Linux: persistent Secret Service/keyutils backend, subject to an available desktop credential service.

If the operating-system credential store is unavailable, AXIS reports that failure. It does not fall back to `localStorage`, `sessionStorage`, a plaintext file, or reversible “frontend encryption.” Browser-only development reports native storage and testing as unavailable.

Keys are never placed in URLs. Native provider probes send authentication in headers, cap model-catalog response size, apply a timeout, and return normalized safe errors rather than raw response bodies or stack traces. Secret-bearing Rust strings use best-effort zeroization where they are under AXIS control.

### Safe local preferences

Only the following non-secret preferences may be stored under `axis:ai-provider-preferences`:

- selected provider ID;
- provider enabled state;
- selected model ID; and
- a validated custom API base URL.

Credentials, request payloads, connection results, errors, usage, and generated content are not persisted there. Theme and sidebar preferences remain stored separately. Command drafts remain session-only and are not submitted.

## Architecture

The provider implementation lives under `src/features/ai/`:

- `domain/` — normalized contracts, safe errors, and request/response normalization;
- `providers/` — validated registry, connection-only adapters, and `AIProviderManager`;
- `services/` — narrow credential and connection gateways to Tauri;
- `security/` — credential validation, endpoint validation, and reusable redaction;
- `state/` — safe preference parsing/persistence and runtime provider state; and
- `components/` — provider cards, model selection, credential controls, statuses, and configuration dialog.

The native implementation lives under `src-tauri/src/ai/`. It owns operating-system credential access, endpoint validation, scoped HTTP connection probes, and normalized command responses. The frontend has no unrestricted shell, filesystem, command, or network bridge.

Adapters expose normalized request and streaming contracts for future Agent Engine integration. In Phase 3, `request()` and `stream()` fail with an explicit normalized `generation_not_enabled` error. Connection testing is the only supported provider network operation.

## Intentionally unavailable

Phase 3 does not implement:

- AI generation or chat responses;
- agents, autonomous execution, or an Agent Engine runtime;
- tool invocation, shell/Python execution, or computer control;
- app connectors or external-application actions;
- workflow execution, project execution, or activity records;
- billing, subscriptions, points, or a marketplace.

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

Vite serves the interface at `http://localhost:1420`. Provider keys cannot be configured in that browser-only view because no insecure web-storage fallback exists.

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
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri:build -- --debug
```

## Production desktop build

```bash
npm run tauri:build
```

Tauri writes native output under `src-tauri/target/`. Native compilation and packaging require the OS libraries documented by Tauri; Linux additionally requires the appropriate WebKitGTK development packages and a Secret Service implementation at runtime.

## Environment files

Copy `.env.example` only for documented non-secret build-time metadata. Never place API keys or credentials in `VITE_` variables: Vite exposes those values to the frontend bundle. Local `.env` variants and common credential/config files are ignored by Git.
