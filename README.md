# AXIS

**One AI. Every Tool.**

AXIS is an installable Windows desktop application. This repository has
progressed through fifteen phases: a secure Electron + TypeScript shell
(Phase 1), UI polish and interaction refinement (Phase 2), a real, secure
**Google Gemini** AI engine foundation (Phase 3), a streaming conversation
experience with bounded in-memory context (Phase 4), local, persistent
conversation history (Phase 5), a premium visual/motion pass with a
subtle animated background (Phase 6), per-conversation export/import
(Phase 7), a frontend-consistency/explanatory-UI cleanup pass (Phase 8),
a second AI provider — **OpenAI** — behind a shared provider interface
(Phase 9), a third provider — **Anthropic Claude** — behind that exact
same interface (Phase 10), bulk "Export all" (Phase 11), its "Import
all" counterpart (Phase 12), drag-and-drop import (Phase 13), a
fourth AI provider — **Mistral AI** — behind that same shared interface
(Phase 14), and a multi-file drag-and-drop import refinement that
surfaces every failure instead of only the first (Phase 15) — see
[AI engine (Gemini, OpenAI, Claude, and Mistral)](#ai-engine-gemini-openai-claude-and-mistral),
[Conversation history (Phase 5)](#conversation-history-phase-5), and
[Scope](#scope-phase-15) below. Tool execution, accounts, cloud sync, and
billing are still not implemented.

Founder: **Sarthak Bharambe** · Co-Founder: **Rudra Zambare**

## Stack

- **Electron** (main process + sandboxed renderer) — chosen because AXIS is
  an installable Windows desktop app; Electron is the standard, well
  supported way to ship a TypeScript web UI as a native desktop binary.
- **TypeScript**, strict mode, compiled separately for the main/preload
  processes (CommonJS, Node target) and the renderer (bundler target).
- **Vite** to bundle and serve the renderer (vanilla TypeScript + HTML/CSS,
  no UI framework — kept deliberately dependency-light for a foundation
  phase).
- **Vitest** + **jsdom** for automated tests of state logic and the DOM-based
  UI contracts.

No AI SDKs or extra HTTP client libraries were added for Gemini — the main
process uses Node/Electron's built-in global `fetch` and `AbortController`.
No UI framework is included either; dependencies remain intentionally
minimal.

## Project layout

```
src/
  main/        Electron main process (window creation, CSP, IPC, security)
    ai/              Gemini + OpenAI + Anthropic provider adapters (shared
                     ProviderAdapter interface, HTTP/SSE helpers),
                     per-provider credential store, IPC controller
                     (provider dispatch)
    conversations/   Local conversation repository (filesystem) + IPC controller
    ipc/             Shared trusted-sender check used by both IPC controllers
  preload/     contextBridge preload script — the ONLY renderer-facing API
  shared/      Types/constants shared between main and renderer
    ipc-contract.ts          IPC channel names
    ai-contract.ts           AI request/response/error/status types + validators
    conversation-contract.ts Conversation schema, validators, title/preview helpers
  renderer/    The actual AXIS UI (HTML, CSS, TypeScript)
    styles/    Design tokens + base/layout/component stylesheets
    ts/
      app.ts           Shell composition (sidebar + topbar + views + dialog)
      state.ts          Small observable store (active view, settings, AI status,
                        pending "open this saved conversation" handoff)
      ai/               Renderer-side AI client, single-shot request lifecycle (Home),
                        streaming conversation controller + bounded context + local
                        persistence (debounced save, load/switch isolation) for the
                        AI Workspace, and the conversation repository IPC client
      components/       Sidebar, composer, example prompts, status/response areas,
                        conversation transcript (renders both live and restored
                        messages through the same safe text/code renderer), dialog
      views/            Home, AI Workspace, History (list/search/rename/delete/
                        clear-all/open), Tools, Settings
      data/             Static example prompt content
tests/         Vitest suites: shell interaction + Gemini/OpenAI/Anthropic/
               Mistral provider, credential isolation, and provider-dispatch
               IPC + conversation persistence/history
  main/              Node-environment tests for the main-process AI (all
                     four providers) + conversation repository/IPC modules
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev:renderer` | Start the Vite dev server for the **browser UI preview** at `http://localhost:5173` |
| `npm run dev:electron` | Build the main/preload processes and launch the real **Electron desktop window**, loading the Vite dev server |
| `npm run build` | Production build of renderer (`dist/renderer`) and main/preload (`dist/`) |
| `npm run electron` | Build and launch the production Electron app (`dist/renderer` via `file://`) |
| `npm run typecheck` | Strict TypeScript check for both the main and renderer projects |
| `npm run test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |

## Previewing the UI

Two distinct ways to look at the interface — use whichever fits your
environment:

1. **Browser UI preview (works anywhere, including this sandbox):**
   ```
   npm run dev:renderer
   ```
   Opens the renderer at `http://localhost:5173`. This renders the exact
   same HTML/CSS/TypeScript the Electron window loads, but inside a regular
   browser tab — it is **not** the native desktop app, just the UI running
   under Vite for fast iteration and remote preview.

2. **Native Electron desktop window (requires a local display — Windows,
   macOS, or Linux with a GUI; does not work in a headless sandbox):**
   ```
   npm run dev:electron   # dev, loads the Vite server
   npm run electron       # production build, loads built files
   ```
   This launches the actual installable-app shell: a real OS window, the
   preload bridge, and the main-process security policy.

> This sandbox has no display server, so the Electron window itself cannot
> be opened here — only the browser preview above was verified in this
> environment. See **Remaining limitations** in the final report.

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on the
  single BrowserWindow — unchanged by the Phase 3 AI work.
- The preload script (`src/preload/preload.ts`) exposes `axis.getAppInfo()`,
  a narrow `axis.ai.*` surface (`getStatus`, `importCredential`,
  `removeCredential`, `testConnection`, `sendRequest`, `cancelRequest`,
  `sendStreamingRequest`, `onStreamEvent`), and a narrow
  `axis.conversations.*` surface: the Phase 5 core (`list`, `search`, `get`,
  `save`, `rename`, `delete`, `clearAll`) plus the Phase 7/11/12
  file-dialog-gated actions (`exportConversation`, `importConversation`,
  `exportAllConversations`, `importAllConversations`). No filesystem, process, shell, or unrestricted
  network access is reachable from renderer JavaScript at all — every
  conversation operation is a single validated round trip to the main
  process, which is the only place that ever touches disk; the raw Gemini
  API key never crosses this bridge in either direction, only status enums
  and response text/event payloads.
- `onStreamEvent` is the one main → renderer **push** channel in AXIS
  (`axis:ai:stream-event`, registered with `ipcRenderer.on` inside the
  preload script only — the renderer never gets direct `ipcRenderer`
  access). Every event is re-validated for shape before the caller's
  callback ever sees it and always carries the originating `requestId`, so
  the AI Workspace can safely ignore anything stale or superseded.
- Every IPC handler in `src/main/ai/aiController.ts` **and**
  `src/main/conversations/conversationsController.ts` re-verifies the call
  came from this app's own window and its top-level frame
  (`event.sender === win.webContents` and `event.senderFrame === win.webContents.mainFrame`)
  via the one shared `createTrustedSenderCheck` helper
  (`src/main/ipc/trustedSender.ts`) before doing anything, and every payload
  is validated against the types in `src/shared/ai-contract.ts` /
  `src/shared/conversation-contract.ts` before use.
- A restrictive `Content-Security-Policy` is enforced both via Electron's
  session headers and an HTML `<meta>` tag (`default-src 'self'`, no
  `unsafe-inline`/`unsafe-eval`, `object-src 'none'`, no external origins).
  This did **not** need to change for Gemini: all Gemini HTTP calls happen
  in the main process (Node `fetch`), never from the renderer, so the
  renderer's CSP never needs an external `connect-src` entry.
- All permission requests (camera, mic, notifications, etc.) are denied by
  default; navigation away from the app and new-window/webview creation are
  blocked; external links open in the OS browser via `shell.openExternal`.

## AI engine (Gemini, OpenAI, Claude, and Mistral)

AXIS's first real AI provider was the **Google Gemini Developer API**
(`src/main/ai/geminiProvider.ts`), added in Phase 3. Phase 9 added a
second, fully optional provider — the **OpenAI Chat Completions API**
(`src/main/ai/openaiProvider.ts`) — Phase 10 added a third — the
**Anthropic Claude Messages API** (`src/main/ai/anthropicProvider.ts`) —
and Phase 14 added a fourth — the **Mistral AI Chat Completions API**
(`src/main/ai/mistralProvider.ts`) — all four behind the exact same shared
interface (`src/main/ai/providerTypes.ts`'s `ProviderAdapter`), so
`aiController.ts` never branches on "if Gemini do X, if OpenAI/Claude/
Mistral do Y" for the request lifecycle itself (validation, single-flight
tracking, timeout/cancel, the streaming relay). Everything
provider-specific — the HTTP request shape, auth header(s), response
parsing, and SSE framing — stays inside that provider's own module; the
four adapters share no request/response parsing with each other, only the
small `classifyHttpError`/`mapFetchException` helpers in
`providerHttp.ts`. Gemini authenticates via the `x-goog-api-key` HTTP
header; OpenAI and Mistral via a standard `Authorization: Bearer` header
(Mistral's API deliberately mirrors OpenAI's Chat Completions request/
response/streaming shape); Claude via an `x-api-key` header plus a
required `anthropic-version` protocol-pinning header. No key is ever sent
as a URL query parameter, logged, or echoed back to the renderer.

**Choosing a provider (Settings → AI Engine → Provider):** a small
segmented control lets you pick Gemini, OpenAI, Claude, or Mistral. Each
provider has its own independent credential (its own on-disk file under
`secure/`, its own in-memory session-key slot — see **Credential
isolation** below), its own status line, and its own Import/Test/Remove
actions; switching the control only changes which provider's status and
actions are currently shown, and which provider the next Home/AI Workspace
request targets. AXIS never claims a provider is "ready" or "connected"
until that provider's own status has actually confirmed a credential is
configured, and a successful **Test connection** only ever reports success
for the provider it was run against.

**Credential isolation.** `src/main/ai/credentialStore.ts` scopes every
function by an explicit provider id (`gemini.cred` / `openai.cred` /
`anthropic.cred` / `mistral.cred` under `secure/`, and a separate
in-memory session-key slot per provider). There is no shared "current
provider" mutable state anywhere in that module, so a request for one
provider can never accidentally read, use, or leak another provider's key
— this is covered by dedicated isolation tests in
`tests/main/credentialStore.test.ts` and `tests/main/aiController.test.ts`.

**Configuring a key (Settings → AI Engine):**

1. Click **Import key file…** to open a native file picker (main-process
   owned). Select a plain text file containing only your API key for the
   provider currently selected in the segmented control above. The
   original file is only ever **read**, never modified or deleted.
2. If your OS has a working encryption backend (`safeStorage`: Windows
   DPAPI, macOS Keychain, or a Linux secret-service/keyring), the key is
   encrypted and saved under your Electron `userData` directory, in a file
   named for that provider (`secure/gemini.cred`, `secure/openai.cred`,
   `secure/anthropic.cred`, or `secure/mistral.cred`).
   AXIS only ever calls it "stored encrypted" after actually confirming
   `safeStorage.isEncryptionAvailable()` is `true`.
3. If encryption is **not** available on the machine (common on a minimal
   Linux install without a keyring — true in this sandbox), AXIS does
   **not** silently write a plaintext file. Settings instead shows a
   **Use for this session only** action: the key is held in main-process
   memory for the current run, under that provider's own session slot, and
   is never written to disk. This is disclosed in the status line (e.g.
   "Gemini ready (session only)", "OpenAI ready (session only)", "Claude
   ready (session only)", or "Mistral ready (session only)").
4. **Test connection** calls a lightweight, non-billable metadata `GET`
   request for the selected provider (Gemini: model metadata; OpenAI,
   Claude, and Mistral: `GET /v1/models`) — never a generation call — to
   confirm the key works.
5. **Remove saved key** deletes the selected provider's on-disk credential
   and/or clears its in-memory session key, leaving the other provider's
   credential (if any) completely untouched.

**Request lifecycle — Home:** the Home composer still calls the original
Phase 3 `window.axis.ai.sendRequest(...)` request/response path: the main
process validates the payload (including the requested `provider`, which
defaults to `"gemini"` when omitted), confirms a credential is configured
for that provider, enforces one in-flight request per window (duplicate
requests are rejected), applies the configurable timeout via
`AbortController`, calls that provider's non-streaming completion endpoint
through the shared `ProviderAdapter` interface, validates the response
shape, and returns one normalized result. This path's behaviour is
unchanged from Phase 3 when Gemini (the default) is selected.

**Request lifecycle — AI Workspace (Phase 4, real streaming):** the
Workspace composer calls `window.axis.ai.sendStreamingRequest(...)`, which
only acknowledges that a stream started (or rejects immediately for a
validation/credential/duplicate problem). The main process then calls the
selected provider's streaming endpoint directly through the same
`ProviderAdapter` interface — Gemini's `streamGenerateContent?alt=sse`,
OpenAI's or Mistral's `chat/completions` with `stream: true`, or Claude's
`messages` with `stream: true` — all Server-Sent Events, read with the
Node/Electron `fetch` body's `ReadableStream` (no extra HTTP/streaming
library), and relays each incremental text chunk to the renderer over the
`onStreamEvent` push channel, tagged with the request's id, followed by
exactly one terminal `done`, `cancelled`, or `error` event. Claude's SSE
protocol is shaped differently from Gemini's/OpenAI's/Mistral's
single-shape `data:` JSON (it uses several named event types —
`message_start`, `content_block_delta`, `message_stop`, etc. — and can
report an error *after* the initial HTTP 200, mid-stream), but
`anthropicProvider.ts` normalizes all of that internally so
`aiController.ts` still only ever sees the same three outcomes (`delta` /
`done` / `error`) as the other three providers. Mistral's SSE shape and
request/response body are OpenAI-compatible, but its error body is flatter
(no nested `error` key) and it uses HTTP 422 (not 400) for
request-validation failures — `mistralProvider.ts` classifies that
specific status itself rather than assuming OpenAI's classification
applies. This is real provider streaming for all four providers — there
is no timer or character-reveal simulation anywhere in this path.
Cancelling a stream calls the exact same
`cancelRequestHandler`/`AbortController` Phase 3 built for the
non-streaming path (the single-flight map is shared by all four and is
provider-agnostic), so stopping a generation, a timeout, and a genuine
provider error all produce visually distinct states in the AI Workspace
transcript, regardless of which provider is selected.

Both paths report cancelling, timing out, missing/invalid credentials,
rate limits, network failures, and malformed/blocked responses as the same
safe, finite error codes (`src/shared/ai-contract.ts`) — never a fabricated
answer and never a raw provider error body.

**Conversation context (Phase 4):** the AI Workspace keeps a small, typed,
in-memory conversation (`src/renderer/ts/ai/conversationContext.ts`). Only
turns that reached a genuine `complete` status ever contribute to the
history sent with the *next* request — a cancelled, failed, or still
in-flight turn is never silently treated as part of the conversation. The
history sent to the selected provider is bounded to at most 8 recent turns
and roughly 6,000 characters total (`MAX_HISTORY_TURNS` /
`MAX_HISTORY_TOTAL_CHARS` in `src/shared/ai-contract.ts`), re-clamped
authoritatively in the main process regardless of what the renderer sends
or which provider is selected. Nothing here is written to disk; "New
conversation" (which requires a second confirming click) clears it
completely, and restarting AXIS always starts with no memory of any
earlier session. Switching the provider mid-conversation does not clear
history — only the credential used for the *next* request changes.

**Costs:** using Gemini, OpenAI, Claude, or Mistral sends requests to
Google, OpenAI, Anthropic, or Mistral AI respectively under *your own*
account for that provider, and may incur usage costs or be subject to
quota limits under that provider's terms. AXIS adds no billing or
subscription of its own.

**Browser preview limitation:** the plain Vite dev-server preview
(`npm run dev:renderer`) has no Electron preload bridge, so `window.axis`
is undefined there. AXIS detects this and shows an explicit "native AI
engine unavailable in this preview" status instead of simulating a key
import or a provider response — native credential import and real
requests (for any of the four providers) can only be exercised in the
real Electron app or via the mocked automated tests in `tests/`.

## Conversation history (Phase 5)

AXIS now saves AI Workspace conversations locally so they can be found and
resumed after you close and reopen the app.

**Storage location.** One plain JSON file per conversation, named
`<conversation-id>.json`, under
`app.getPath('userData')/conversations/` (on Windows this is typically
`%APPDATA%/AXIS/conversations/`; it is **not** the same folder Phase 3 uses
for the encrypted credential, `.../secure/gemini.cred` — conversation files
never contain API key material, and this module never imports
`credentialStore.ts`). Every write goes to a temporary sibling file first,
then is renamed into place, so a crash mid-write can only ever leave an
orphaned temp file, never a half-written conversation file.

**Not encrypted — plain JSON.** Unlike the Gemini credential, conversation
files are **not** encrypted. AXIS does not claim otherwise anywhere in the
UI or this document. Anyone with filesystem access to your user profile can
read saved conversation text. If this matters for your use case, avoid
discussing sensitive information in the AI Workspace, or delete
conversations you don't want kept (see below).

**Data model** (`src/shared/conversation-contract.ts`): each conversation
is `{ id, title, createdAt, updatedAt, messages[] }`, where each message is
`{ id, role: "user" | "assistant", text, status, truncated, errorMessage?, createdAt }`.
`status` is one of `complete`, `cancelled`, `error`, or `incomplete` — a
turn that was still streaming when it was last saved (e.g. the app closed
mid-response) is always written as `incomplete`, never as `complete` or as
a live "pending" state, and is shown that way (with a Retry option) when
the conversation is reopened. Nothing beyond this shape is ever persisted —
no credentials, no raw IPC payloads, no internal debugging data.

**Schema versioning.** Every file on disk is wrapped in a small envelope,
`{ schemaVersion: 1, conversation: {...} }`. A file with a missing, older,
or newer `schemaVersion` than this build understands is treated as
unreadable and safely skipped (never guessed at, never crashes the app) —
this is the designated boundary a future schema change would extend with
an explicit migration step. Every record is also independently validated
(ids, roles, statuses, size bounds) before it is ever trusted or rendered,
regardless of whether its JSON parsed — parsing uses `JSON.parse` only,
never `eval` or a template engine, so a corrupt or crafted file can only
ever become inert data.

**History screen** (`src/renderer/ts/views/history.ts`): lists every saved
conversation sorted by most-recently-updated, with loading/empty/error/
search-no-results states. Search matches saved titles and message text only
— it is a local, in-process string match with no network or AI call
involved. Each item can be **opened** (switches to the AI Workspace and
restores its transcript), **renamed** inline, or **deleted** (a second
confirming click is required, mirroring the existing "New conversation"
pattern — no native `confirm()` dialog). **Clear all** needs the same
two-click confirmation. Deleting removes the file immediately, so it never
appears in a later list or search.

**Workspace integration.** Every new conversation gets a fresh id; the
title is generated from the first prompt (safely truncated, never empty)
and can be renamed from History. A still-streaming turn is only ever
debounced to disk (roughly every 1.5 seconds) so a fast stream never causes
a disk write per token; every terminal outcome (done, cancelled, or error)
flushes a save immediately, and a save failure is reported honestly in the
Workspace (never presented as if the message was saved). Reopening a saved
conversation — or starting/clearing one — always **cancels any in-flight
request first**, which both saves the conversation being left and clears
the active-request id, so a response that arrives late for an abandoned
request can never be misapplied to a different, now-open conversation; this
is covered by dedicated tests in `tests/workspacePersistence.test.ts` and
`tests/conversationControllerPersistence.test.ts`. Continuing a reopened
conversation sends Gemini the same bounded, "complete-turns-only" history
Phase 4 already enforced — a cancelled, failed, or incomplete turn is never
included.

**Rendering.** Restored messages go through the exact same safe renderer as
live streamed ones (`src/renderer/ts/ai/textSegments.ts` +
`src/renderer/ts/components/conversationView.ts`): plain `textContent`
only, never `innerHTML`, so stored text that looks like HTML or script can
never execute.

**Privacy.** Conversation data stays on your device. AXIS adds no
analytics, telemetry, or transmission of conversation content to any new
service — the only network calls this app ever makes are the Gemini
requests you explicitly send.

**Browser preview limitation.** Same as the AI engine above: the Vite
dev-server preview has no Electron preload bridge, so `axis.conversations`
is undefined there too. History shows an explicit "native bridge
unavailable — run the AXIS desktop app" error state in that preview rather
than pretending to load, search, or save conversations. Loading, saving,
restoring, and deleting real conversation files on disk can only be
exercised in the real Electron app or via the main-process-module and
mocked-bridge automated tests in `tests/`.

## Scope (Phase 3)

Implemented: a typed, provider-agnostic AI request/response/error contract;
a real Gemini Developer API client (header-based auth, timeouts,
cancellation, response validation); `safeStorage`-backed (or explicit
session-only) credential storage via a native file-picker import flow;
narrow, validated, sender-checked IPC channels; a real composer request
lifecycle on Home and AI Workspace (loading, cancel, honest errors, safe
text rendering, draft preservation); a Settings section for configuring,
testing, and removing the Gemini key and a wired request-timeout
preference.

## Scope (Phase 4)

Implemented, on top of Phase 3 (Home is untouched): a real streaming AI
Workspace conversation (`streamGenerateContent?alt=sse`, relayed over one
narrow, validated, request-ID-tagged push IPC channel — no fake/simulated
streaming); a scrollable turn-by-turn transcript with clear prompt/response
typography, distinct visual states for generating/complete/stopped/failed
turns, a "may be incomplete" note on provider-truncated answers, safe
fenced-code-block rendering (plain-text splitting + `textContent` only —
no Markdown-to-HTML dependency, no `innerHTML` with model output), and
copy-response/copy-code actions; a bounded, typed, in-memory conversation
context (`src/renderer/ts/ai/conversationContext.ts`) that only ever feeds
genuinely completed turns back to Gemini as history; explicit "Stop
generation", "Retry" (never automatic), and "New conversation" (two-click
confirm) controls.

## Scope (Phase 5)

Implemented, on top of Phase 4: a typed, versioned, validated local
conversation repository (`src/main/conversations/conversationRepository.ts`)
using plain (unencrypted) JSON files under
`app.getPath('userData')/conversations/`, written with a temp-file-then-
rename strategy; a narrow, sender-checked, validated
`axis.conversations.*` IPC surface
(`src/main/conversations/conversationsController.ts`); a full History
screen (list, local title/message search, most-recently-updated sort,
inline rename, two-click delete, two-click clear-all, open/resume, and
loading/empty/error/no-results states); AI Workspace integration that
auto-generates a truncated title from the first prompt, debounces
in-progress saves (~1.5s) while flushing immediately on every terminal
outcome, honestly marks interrupted turns as `incomplete` rather than
`complete`, cancels any in-flight request before switching/reopening/
clearing a conversation so a late response can never land in the wrong
conversation, and restores saved transcripts through the exact same safe
renderer used for live messages.

Not implemented (by design, for a later phase): any AI provider other than
Gemini, cloud sync or multi-device access to saved conversations, tool or
OS automation/execution, accounts, billing/subscriptions, or an
installer/release build. Per-conversation export/import was added in
[Phase 7](#scope-phase-7). A second AI provider (OpenAI) was added in
[Phase 9](#scope-phase-9); everything else in this list remains
out of scope.

## Scope (Phase 6)

A visual and motion pass on top of Phase 5 — no new features, no screens
rebuilt, no change to the AI/persistence architecture.

- **Palette.** Already charcoal/graphite/slate with a restrained blue
  accent (`src/renderer/styles/tokens.css`, unchanged this phase) —
  confirmed to already meet the "no neon, no rainbow, no glow" standard,
  so no palette changes were needed.
- **Ambient background.** A purely decorative layer
  (`.axis-ambient`/`.axis-ambient__blob` in `layout.css`, two `<span>`s
  appended in `app.ts`) renders two large, heavily blurred, very low
  opacity (`0.14`) shapes that drift slowly (48–64s loops) behind the
  sidebar and main content, which now sit at `z-index: 1` above it. It is
  `aria-hidden`, `pointer-events: none`, CSS-only (no library), and is
  neutralized both by the existing blanket `prefers-reduced-motion` /
  `[data-motion="reduced"]` rule in `tokens.css` and by an explicit
  `animation: none` override on the blobs themselves.
- **Motion polish.** A short, subtle enter transition (opacity + 4px
  translateY, 180ms) was added to History list items, matching the
  existing `axis-view-enter` / dialog-enter patterns. It was deliberately
  **not** added to AI Workspace turns, because that list is re-rendered on
  every streamed delta — animating it would flicker on every token instead
  of only on genuine new content.
- **No tutorial-style UI.** Removed generic explanatory paragraphs from the
  Home, AI Workspace, History, Tools, and Settings page headers (e.g. "This
  is your dedicated workspace for a back-and-forth conversation with
  AXIS…") and the Workspace's "Not sure where to start?" hint, replacing
  each with a single short, factual line. Functional feedback — loading,
  error, empty, confirmation, and cost/privacy disclosures — was left
  exactly as-is; none of it was tutorial copy. A broader explanatory-UI
  cleanup remains for the dedicated frontend cleanup phase described in
  the original roadmap, not this one.
- **Stale-copy fix.** The AI Workspace's empty-state text still claimed
  "nothing is saved to disk," left over from before Phase 5 added
  persistence — corrected to reflect that conversations are now saved
  locally.
- **Known Phase 5 issue, now fixed.** Renaming a conversation in History
  while it is open in the AI Workspace now updates the displayed title in
  place. This does **not** reopen the conversation or duplicate its title
  in the store: `conversationController` remains the sole owner of the
  displayed title, and History simply emits a one-shot
  `store.notifyConversationRenamed(id, title)` event (a plain push
  channel, not persisted state) that the open Workspace applies only if
  the id matches the conversation currently shown.

## Scope (Phase 7)

Per-conversation export and import, the next documented gap from
[Scope (Phase 5)](#scope-phase-5)'s "not implemented" list — no other
roadmap item (cloud sync, other AI providers, accounts, billing,
installer/release, OS/tool automation) was touched.

- **Export.** A new "Export" button on each History item opens a native
  Save dialog (`dialog.showSaveDialog`, main process only) pre-filled with
  the conversation's title as the suggested filename, and writes that one
  conversation as a plain-JSON `ConversationFileV1` envelope — the exact
  same schema/shape every conversation is already stored as on disk. The
  renderer only ever sends a conversation id over IPC and receives a
  pass/fail/cancelled result; it never sees a file path or file contents.
- **Import.** A new "Import…" button in the History controls row opens a
  native Open dialog (`dialog.showOpenDialog`). The chosen file is parsed
  and validated through the exact same schema/envelope validators every
  on-disk conversation already goes through — a malformed, hand-edited, or
  unrelated JSON file is rejected, never trusted just because it parsed.
  A successful import is always saved under a **brand-new id**
  (`crypto.randomUUID()`), never the id recorded inside the file, so
  importing can never silently overwrite an existing conversation, and
  importing the same exported file twice always produces two independent
  conversations rather than a collision.
- **Cancelling is not an error.** Dismissing either native dialog reports
  a `CANCELLED` result that both buttons treat as a silent no-op (no error
  banner), matching the existing Settings credential-import UX.
- **No new dependencies, no UI chrome added beyond two buttons.** Both
  actions reuse the existing History screen, the existing IPC
  trusted-sender/validation pattern, and the existing
  `ConversationFileV1`/error-code contract (which gained one new
  `CANCELLED` code). The charcoal/graphite/slate palette, the Phase 6
  ambient background, and reduced-motion support are all unaffected.
- **Not implemented in Phase 7 (deliberately out of scope):** bulk
  export-all / export-everything, drag-and-drop import, any cloud or
  multi-device sync of exported files, and any other roadmap item listed
  as not-yet-implemented above.

## Scope (Phase 8)

A frontend-consistency and explanatory-UI cleanup pass across the whole
app — no new screens, no new features, no change to the AI/persistence
architecture. Phase 6 already removed the large tutorial-style paragraphs
from every page header; this phase inspected what remained for smaller,
genuine wording/consistency inconsistencies rather than assuming a problem
existed.

- **Unused nav-item copy removed.** `NavItem.description` (`src/renderer/ts/types.ts`)
  was template-style leftover data — populated for every sidebar item but
  never actually rendered anywhere (the sidebar only ever used `label`).
  Removed as dead code rather than left to suggest a feature that doesn't
  exist.
- **Duplicate UI element, inconsistent label.** Home and the AI Workspace
  both render the exact same example-prompt grid component with the same
  data, but used two different section labels ("Try an example" vs.
  "Example prompts") for it. Unified to "Example prompts" in both places.
- **Inconsistent two-click confirmation wording.** AXIS has three
  destructive, double-click-to-confirm actions — "New conversation",
  History's "Clear all", and History's per-item "Delete" — and two of them
  already shared a "Click again to …" phrasing convention while the third
  used an unrelated "Confirm delete" pattern. Unified History's Clear-all
  ("Click again to clear all") and per-item Delete ("Click again to
  delete", with the aria-label updated to match) to the same convention
  already used by "New conversation" ("Click again to clear"), so the same
  interaction pattern reads the same way everywhere it appears.
- **Inspected and found already consistent, left unchanged:** the
  charcoal/graphite/slate palette and restrained accent (`tokens.css`), the
  shared `axis-btn`/`axis-card`/`axis-badge`/`axis-empty-state` component
  styles (already token-driven, already reused identically across Home,
  Workspace, History, Tools, and Settings), the Phase 6 ambient background
  and reduced-motion handling, every empty/loading/error state's wording,
  and every remaining "description" line on a page header (all single,
  factual sentences, not tutorial copy) — none of these showed an actual
  inconsistency on inspection, so none were changed to avoid unnecessary
  churn.
- **Deliberately not touched:** all functional feedback — loading/error/
  empty states, the Gemini cost/privacy disclosure, the session-only
  credential warning, and every destructive-action confirmation's
  underlying two-click behavior (only the wording was unified, not the
  mechanism) — and no new dependencies, providers, or screens were added.

## Scope (Phase 9)

A second AI provider — **OpenAI** — added behind the existing provider
architecture, chosen over Anthropic because OpenAI's Chat Completions API
maps cleanly onto the request/response and SSE-streaming shapes Phase 3/4
already built for Gemini (simple Bearer auth, a widely-documented
`stream: true` SSE format, and a lightweight non-billable `GET /v1/models`
endpoint usable for **Test connection**), letting the whole feature be
delivered as additive adapter code with no changes to the request
lifecycle, cancellation, or streaming relay that Gemini already relies on.

- **New shared provider vocabulary** (`src/shared/ai-contract.ts`):
  `AiProviderId` (`"gemini" | "openai"`), `AI_PROVIDER_IDS`,
  `AI_PROVIDER_LABELS`, `isValidProviderId`, `resolveProviderId` (defaults
  invalid/missing input to `"gemini"` — the behaviour every Phase 3–8
  caller already implicitly assumed), and `isValidProviderScopedPayload`.
  Every existing IPC payload validator (`isValidSendRequestPayload`,
  `isValidImportPayload`, etc.) now also validates an **optional**
  `provider` field, so Phase 3–8 callers that never set it keep working
  unchanged.
- **New shared adapter interface** (`src/main/ai/providerTypes.ts`): a
  `ProviderAdapter` shape (`send`, `stream`, `testConnection`) that both
  `geminiProvider.ts` and the new `openaiProvider.ts` implement
  independently — no shared base class, no provider-specific branching
  inside the controller's request lifecycle. A small shared
  `src/main/ai/providerHttp.ts` holds only genuinely provider-agnostic HTTP/
  SSE plumbing (timeout wiring, line-buffered SSE frame parsing) — nothing
  about request/response shape or error mapping, which stay inside each
  provider's own module.
- **New `src/main/ai/openaiProvider.ts`:** Chat Completions API
  (`POST https://api.openai.com/v1/chat/completions`, model
  `gpt-4o-mini`), `Authorization: Bearer <key>` auth, SSE streaming via
  `stream: true`, and `GET /v1/models` for **Test connection**. Maps
  OpenAI's error shapes (401/403 invalid key, 429 rate limit, network
  failure, malformed body) onto the exact same finite, safe error codes
  Gemini already uses — never a raw provider error body, never a secret in
  a log line or an error message.
- **`src/main/ai/credentialStore.ts` and `aiController.ts`** were extended
  to take an explicit `provider` argument everywhere (file names, in-memory
  session-key slots, the single-flight request map, every IPC handler) so
  that a request for one provider can never read or leak the other
  provider's credential. `aiController.ts` validates the requested provider
  id **before** touching any provider-specific code — an unknown provider
  id is rejected as a `VALIDATION_ERROR` without ever calling either
  adapter.
- **Minimal Settings UI addition** (`src/renderer/ts/views/settings.ts`): a
  small segmented control ("Gemini" / "OpenAI") using the existing
  `axis-segmented`/`axis-settings-row` component styles — no new cards, no
  tutorial copy. Switching it re-fetches that provider's own status and
  re-scopes the existing Import/Use-session-only/Test/Remove actions to it;
  the selection persists in the existing `axis.settings.v1` localStorage
  key alongside the other UI preferences Phase 5+ already stores there.
  Gemini's configuration and behaviour are unchanged when selected (the
  default, matching every pre-Phase-9 save).
- **Home and AI Workspace** now send the currently-selected provider id
  with every request (`buildSendPayload`/the streaming request builder);
  when no provider has ever been selected the field is simply omitted and
  the main process defaults to Gemini, so existing saved settings/behaviour
  from Phases 3–8 are unaffected.
- **Conversation history, export/import schemas unchanged.** Phase 9 did
  not need to touch `conversation-contract.ts`, the repository file format,
  or the export/import JSON shape — provider selection is a Settings-level,
  per-request concern, not a per-conversation one, so no migration was
  required or written.
- **Tests added this phase:** `tests/main/openaiProvider.test.ts` (new,
  OpenAI adapter request/response/error/streaming/cancellation behaviour,
  mocked HTTP/SSE), a new credential-isolation block in
  `tests/main/credentialStore.test.ts`, a new multi-provider-dispatch block
  in `tests/main/aiController.test.ts` (provider routing, pre-dispatch
  validation, non-leaking credential lookups, streaming routing), new
  provider-validator cases in `tests/ai-contract.test.ts`, a new
  `tests/settingsProvider.test.ts` (the Settings provider switcher never
  claims a provider connected prematurely, correctly scopes every
  credential action, persists the selection), and new provider-forwarding
  cases in `tests/aiClient.test.ts` and `tests/workspaceConversation.test.ts`.
  Full suite: **353/353 tests passing** (23 files), `tsc --noEmit` clean on
  both the main and renderer project configs, and `npm run build` (renderer
  + main) succeeds.
- **Verified only in the mocked-bridge browser preview** (`npm run
  dev:renderer`) and in the automated test suite above — i.e. that the new
  Settings control renders, switches, and scopes actions correctly, and
  that the request/response/streaming/error-handling logic behaves
  correctly against **mocked** HTTP/SSE responses. **No real OpenAI (or
  Gemini) API request was made or could be made in this sandbox** (no
  outbound network access to `api.openai.com`/`generativelanguage.
  googleapis.com`), so genuine end-to-end connectivity, and the native
  Electron `safeStorage`/OS-keychain credential-persistence path, remain
  unverified here and can only be confirmed by running the built app on a
  real machine with real API keys.
- **Not implemented (deliberately out of scope):** any provider beyond
  OpenAI and Gemini, payments/subscriptions/accounts/cloud sync/
  marketplace features, OS automation, an installer/release build, or any
  change to the conversation storage/export schema. A third provider
  (Anthropic Claude) was added in [Phase 10](#scope-phase-10); everything
  else in this list remains out of scope.

## Scope (Phase 10)

A third AI provider — **Anthropic Claude** — added behind the exact same
provider architecture Phase 9 established, the next item on Phase 9's own
explicit "not implemented" list ("any provider beyond OpenAI and Gemini").
Every other item on that list (billing/accounts/cloud sync/marketplace, OS
automation, an installer/release build, a conversation-schema change) is
out of scope for this phase too, per this phase's own strict scope
restrictions, so none of them were touched.

- **Architecture validated the premise.** Inspecting `aiController.ts`,
  `credentialStore.ts`, `providerTypes.ts`, and `settings.ts` confirmed the
  Phase 9 design already generalizes to any number of providers, not just
  two: `aiController.ts`'s `PROVIDER_ADAPTERS` is a `Record<AiProviderId,
  ProviderAdapter>` with no provider-count assumption, `credentialStore.ts`
  scopes every function by an explicit provider id with no hardcoded pair,
  and `settings.ts`'s provider control already iterates
  `AI_PROVIDER_IDS`/`AI_PROVIDER_LABELS` rather than hardcoding "Gemini or
  OpenAI". Adding Claude required no changes to the request lifecycle,
  IPC contracts, streaming relay, cancellation, or renderer component
  structure — only a new adapter module, one new line in the adapter
  registry, and completing two provider-keyed lookup tables the compiler
  already flagged as incomplete (`COST_NOTES` in `settings.ts`, and a
  single hardcoded `provider === "openai" ? "OpenAI" : "Gemini"` label
  ternary in `credentialStore.ts`, generalized to read from
  `AI_PROVIDER_LABELS` instead — the one piece of Phase 9 code that had not
  yet been written generically).
- **New `src/main/ai/anthropicProvider.ts`:** the **Messages API**
  (`POST https://api.anthropic.com/v1/messages`), authenticated with an
  `x-api-key` header plus the required `anthropic-version: 2023-06-01`
  protocol-pinning header (confirmed current via Anthropic's own live docs
  while implementing this — that version string has identified the
  streaming/field-set protocol since 2023 and does not track model
  releases). Default model `claude-haiku-5-5` — confirmed active on
  Anthropic's own models-overview page at implementation time, chosen for
  the same "fast, cheap, widely available" reasoning Phase 9 used for
  OpenAI's `gpt-4o-mini`, rather than Anthropic's own pricier "start here"
  flagship recommendation. `GET /v1/models` is used for **Test
  connection** (non-billable, same policy as the other two providers).
  Claude's streaming protocol uses several **named SSE event types**
  (`message_start`, `content_block_delta`, `message_delta`, `message_stop`,
  `ping`, and a stream-level `error` event that can arrive *after* the
  initial HTTP 200) rather than Gemini's/OpenAI's single-shape `data:`
  JSON — `anthropicProvider.ts` parses these itself and still only ever
  yields the same three outcomes (`delta` / `done` / `error`) the shared
  `ProviderAdapter` interface expects, including treating a documented
  Claude `stop_reason: "refusal"` the same way Gemini's safety-block and
  OpenAI's `content_filter` are already treated (`BLOCKED_BY_PROVIDER`,
  never a fabricated answer).
- **`src/shared/ai-contract.ts`:** `AiProviderId` extended to
  `"gemini" | "openai" | "anthropic"`; `AI_PROVIDER_IDS` and
  `AI_PROVIDER_LABELS` (label: "Claude", Anthropic's product name — the
  same "recognizable product name" convention as "Gemini") gained the new
  entry; `isValidProviderId` now accepts it. No other shared type changed
  shape — `resolveProviderId` still defaults anything unrecognized to
  `"gemini"`, exactly as it did in Phase 9.
- **`src/main/ai/aiController.ts`:** one new import and one new
  `PROVIDER_ADAPTERS.anthropic` entry. No other line in this file changed —
  the validation order (provider id checked before any adapter is ever
  touched), single-flight tracking, timeout/cancel wiring, and the
  streaming relay are unchanged and apply identically to Claude.
- **Settings UI:** no new markup was written. `AI_PROVIDER_IDS.map(...)`
  already building the segmented control from the shared id list meant
  Claude simply appeared as a third option; only the provider-keyed
  `COST_NOTES` copy table needed a new entry (TypeScript's
  `Record<AiProviderId, string>` made this a compile error otherwise,
  rather than a silently-missing case).
- **Home and AI Workspace, conversation history, export/import schemas:
  unchanged**, for the same reason Phase 9 didn't need to touch them —
  provider selection is a Settings-level, per-request concern.
- **Tests added this phase:** new `tests/main/anthropicProvider.test.ts`
  (25 tests: auth headers, Messages API request/response parsing, named-SSE
  streaming including the mid-stream-error-after-200 case, `refusal`/
  `max_tokens` handling, error-code mapping, cancellation — all against
  mocked HTTP/SSE, exactly like the existing Gemini/OpenAI provider test
  files); a new three-provider isolation block in
  `tests/main/credentialStore.test.ts`; new Claude-specific dispatch cases
  in `tests/main/aiController.test.ts`'s multi-provider describe block
  (send/stream routing, independent credential lookups, test-connection
  routing, credential-handler forwarding); updated `tests/ai-contract.test.ts`
  cases (the three now-valid provider ids, with a new placeholder invalid
  id, `"mistral"`, replacing `"anthropic"` in every negative-path
  assertion now that it is a real provider); new Claude cases in
  `tests/settingsProvider.test.ts` (the segmented control offers Claude as
  a third option, switching to it persists/refetches/scopes credential
  actions correctly, and it is never shown as connected prematurely); and
  new provider-forwarding cases in `tests/aiClient.test.ts` and
  `tests/workspaceConversation.test.ts`. Full suite: **390/390 tests
  passing** (24 files), `tsc --noEmit` clean on both the main and renderer
  project configs, and `npm run build` (renderer + main) succeeds.
- **Verified only in the mocked-bridge browser preview** (`npm run
  dev:renderer`, confirmed live-reloading the updated Settings view with
  the new Claude option) and in the automated test suite above — i.e. that
  the provider control offers Claude correctly, and that
  request/response/streaming/error-handling logic behaves correctly
  against **mocked** HTTP/SSE responses built from Anthropic's own
  documented shapes. **No real Anthropic (or OpenAI/Gemini) API request
  was made or could be made in this sandbox** (no outbound network access
  to `api.anthropic.com`), so genuine end-to-end connectivity, and the
  native Electron `safeStorage`/OS-keychain credential-persistence path for
  the new `anthropic.cred` file, remain unverified here and can only be
  confirmed by running the built app on a real machine with a real
  Anthropic API key.
- **Not implemented (deliberately out of scope):** any provider beyond
  Gemini, OpenAI, and Anthropic; payments/subscriptions/accounts/cloud
  sync/marketplace features; OS/shell/terminal automation; an
  installer/release build; a website or developer portal; or any change to
  the conversation storage/export schema.

## Scope (Phase 11)

**Bulk export ("Export all")** — the next documented gap from
[Scope (Phase 7)](#scope-phase-7)'s own "not implemented" list, which named
three remaining items: "bulk export-all / export-everything,
drag-and-drop import, any cloud or multi-device sync of exported files".
Cloud/multi-device sync is forbidden outright by this phase's standing
restrictions. Of the two remaining, legitimately in-scope items,
**bulk export-all** was selected over drag-and-drop import because it is
explicitly, unambiguously named (export every saved conversation at once)
and fits the existing security model exactly as-is — the main process
still does 100% of the file I/O via a native `dialog.showSaveDialog`,
identical in shape to Phase 7's per-conversation export. Drag-and-drop
import would instead require a new renderer-reads-file-content pathway
(the HTML5 File API) that is a bigger deviation from "the renderer never
touches a file directly", plus open UX questions (drop target scope,
multi-file handling) better scoped as its own future phase. Bulk
**import** was likewise left out of this phase — only "export-all" was
named in the Phase 7 deferred list, and adding an importer for it now
would be unapproved scope expansion.

- **New shared envelope, `ConversationBulkFileV1`**
  (`src/shared/conversation-contract.ts`): `{ schemaVersion: 1, kind:
  "axis-conversations-bulk", exportedAt, conversations: ConversationRecord[]
  }`, plus a new `isValidConversationBulkFile` validator. This is strictly
  **additive** — `ConversationFileV1` (the per-conversation on-disk/export
  shape) is completely unchanged, and nothing in the app reads a bulk file
  back in this phase. A previously-exported bulk file fed into the
  existing single-conversation **Import** button will honestly fail
  validation (`kind` doesn't match) rather than partially importing —
  a documented limitation, not a bug.
- **`src/main/conversations/conversationRepository.ts`:** new
  `exportAllToFile(destPath)`, reusing the exact same
  `readAllValidRecords()` + `sortByUpdatedDesc()` path `listSummaries`
  already uses (so the bulk file's ordering matches the History list), then
  writing the envelope with a plain `fs.writeFile` — the same one-off-copy
  pattern `exportConversationToFile` already uses, not the atomic
  temp-rename dance reserved for this app's own canonical on-disk records.
  A corrupt individual conversation file is silently skipped, same
  tolerance every other read path already has; an empty conversation list
  writes `conversations: []` rather than erroring, matching how `clearAll`
  doesn't special-case an empty directory either.
- **`src/main/conversations/conversationsController.ts`:** new
  `exportAllHandler`, same trusted-sender check and no-payload shape as
  `clearAllHandler`/`importHandler`. Opens a save dialog defaulting to
  `axis-conversations-export.json`; a cancelled dialog reports `CANCELLED`
  (not an error), exactly like the per-conversation export handler.
- **New IPC channel** `conversationsExportAll` (`axis:conversations:export-all`)
  added to `src/shared/ipc-contract.ts`, wired through the preload bridge
  (`exportAllConversations()` in `src/preload/preload.ts`) and the
  renderer's type declarations (`src/renderer/ts/global.d.ts`) using the
  exact same pattern as every existing conversations channel — still no
  filesystem access of any kind reaches the renderer directly.
- **Renderer:** a new `exportAllConversations()` client function
  (`src/renderer/ts/ai/conversationRepositoryClient.ts`) and a new
  "Export all" button in the History controls row
  (`src/renderer/ts/views/history.ts`), disabled whenever the conversation
  list is empty (same convention as the existing "Clear all" button). A
  cancelled export is a silent no-op; a genuine failure shows the same
  honest error state every other History action already uses. No new CSS
  was needed — `.axis-history-controls` was already a wrapping flex row.
- **No new dependencies.** Every piece reuses existing Electron APIs
  (`dialog.showSaveDialog`), existing IPC/validation patterns, and existing
  UI components.
- **Tests added this phase:** `exportAllToFile` cases in
  `tests/main/conversationRepository.test.ts` (bulk envelope shape and
  ordering, empty-list handling, a corrupt sibling file being skipped,
  storage-error propagation); `exportAllHandler` cases in
  `tests/main/conversationsController.test.ts` (untrusted-sender rejection,
  cancelled dialog, successful write, repository-failure propagation);
  `isValidConversationBulkFile` cases in `tests/conversation-contract.test.ts`;
  new IPC-channel-count/list assertions in `tests/ipc-contract.test.ts`; and
  new "Export all" cases in `tests/historyView.test.ts` (disabled-when-empty,
  successful export, cancelled-is-silent, error banner on genuine failure).
  Full suite: **404/404 tests passing** (24 files — up from Phase 10's 390),
  `tsc --noEmit` clean on both the main and renderer project configs, and
  `npm run build` (renderer + main) succeeds.
- **Verified only in the mocked-bridge browser preview** (`npm run
  dev:renderer`; a direct fetch of the served `history.ts` module confirmed
  the live dev server returns the new "Export all" button/id) and in the
  automated test suite above, which exercises the real repository/controller
  logic against a real temp-directory filesystem but a **mocked** Electron
  `dialog` module (no real Electron binary is available in this sandbox).
  The native Electron save-dialog flow, and writing to a real end-user
  filesystem path outside this sandbox, remain unverified here and can only
  be confirmed by running the built app on a real machine.
- **No real network/API calls were relevant to or performed for this
  feature** — bulk export is a local-filesystem-only operation with no AI
  provider involved.
- **Not implemented (deliberately out of scope):** bulk/drag-and-drop
  import of a multi-conversation file; any cloud or multi-device sync of
  exported files; any change to the conversation storage/export schema
  beyond the additive new `ConversationBulkFileV1` type; any provider,
  billing, OS-automation, installer/release, or website/portal work (all
  still out of scope per this phase's own restrictions).

## Scope (Phase 12)

**Bulk import ("Import all")** — closing the exact gap Phase 11 itself
documented and left open. Phase 11 added the `ConversationBulkFileV1`
envelope and an "Export all" action, but explicitly deferred an importer
for it ("adding an importer for it now would be unapproved scope
expansion") and called out as a known limitation that feeding a bulk file
into the single-conversation **Import** button would honestly fail
validation. [Scope (Phase 7)](#scope-phase-7)'s own deferred list still
separately named "bulk... import of a multi-conversation file" as
unfinished. Drag-and-drop import (the other half of that Phase 7 item) was
considered and **not** selected: it requires a new renderer-reads-file-
content pathway via the HTML5 File API, a materially bigger deviation from
"the main process owns 100% of file I/O" than reusing the existing native
open-dialog pattern, plus open UX questions (drop target scope, multi-file
handling) explicitly flagged in Phase 11 as better left to its own future
phase. Bulk import, by contrast, is a direct, narrowly-scoped counterpart
to a feature that already exists, fits the existing native-dialog
architecture exactly, and was the more conservative, clearly-authorized
choice.

- **`src/main/conversations/conversationRepository.ts`:** new
  `importAllFromFile(sourcePath)`. Reads and validates the file strictly
  against `isValidConversationBulkFile` — the distinct
  `kind: "axis-conversations-bulk"` discriminator means a per-conversation
  `ConversationFileV1` export can never be accepted here, and vice versa
  for the single-conversation importer; the two formats are never
  confused. Every conversation in the file is saved one at a time through
  the existing `saveConversation` path (full validation, normalization,
  atomic write) and always under a **brand-new id**
  (`crypto.randomUUID()`), never the id recorded in the file — exactly the
  same no-overwrite, no-collision guarantee
  `importConversationFromFile` already gives the single-conversation case.
  Importing the same bulk file twice, or a bulk file containing an id that
  happens to match an already-saved conversation, always produces
  independent conversations rather than overwriting anything. An empty
  `conversations: []` array imports zero conversations without erroring.
  If an individual write genuinely fails partway through (e.g. a disk
  error), conversations already written stay written — the same partial-
  progress honesty `clearAll` already has — and the reported failure
  states exactly how many succeeded first.
- **`src/main/conversations/conversationsController.ts`:** new
  `importAllHandler`, same trusted-sender check and no-payload shape as
  `importHandler`/`clearAllHandler`. Opens a native open dialog titled
  "Import all conversations"; a cancelled dialog reports `CANCELLED`, not
  an error. The repository's `importedCount` is intentionally **not**
  forwarded to the renderer — the same way `saveHandler` already discards
  the full conversation it gets back from `saveConversation` — the
  refreshed History list is the source of truth for what is now saved.
- **New IPC channel** `conversationsImportAll`
  (`axis:conversations:import-all`), added to `src/shared/ipc-contract.ts`
  and wired through the preload bridge
  (`importAllConversations()` in `src/preload/preload.ts`) and the
  renderer's type declarations (`src/renderer/ts/global.d.ts`) using the
  exact same pattern as every existing conversations channel.
- **Renderer:** a new `importAllConversations()` client function
  (`src/renderer/ts/ai/conversationRepositoryClient.ts`) and a new
  "Import all…" button in the History controls row
  (`src/renderer/ts/views/history.ts`), placed next to the existing
  "Import…" button. Unlike "Export all"/"Clear all", it is **never**
  disabled based on the current list being empty — importing is always
  possible regardless of what is already saved, matching the existing
  "Import…" button's behavior. A cancelled import is a silent no-op; a
  genuine failure (e.g. picking a single-conversation export file by
  mistake) shows the same honest error state every other History action
  already uses.
- **No schema change.** `ConversationBulkFileV1` (Phase 11) and
  `ConversationFileV1` (Phase 5/7) are both completely unchanged — this
  phase only adds a *reader* for the existing bulk envelope, not a new
  format.
- **No new dependencies.** Reuses the existing `dialog.showOpenDialog`
  Electron API, existing IPC/validation patterns, and existing UI
  components.
- **Tests added this phase:** `importAllFromFile` cases in
  `tests/main/conversationRepository.test.ts` (saves every conversation
  under new ids, importing the same file twice produces two independent
  sets, zero-conversation file is not an error, never overwrites an
  existing conversation with a colliding id, rejects a per-conversation
  file, rejects invalid JSON/shape, propagates a storage read failure);
  `importAllHandler` cases in `tests/main/conversationsController.test.ts`
  (untrusted-sender rejection, cancelled dialog, successful import
  discarding the count, validation-failure propagation);
  new IPC-channel-count/list assertions in `tests/ipc-contract.test.ts`;
  and new "Import all…" cases in `tests/historyView.test.ts`
  (successful bulk import and list refresh, always-enabled regardless of
  an empty list, cancelled-is-silent, error banner on genuine failure).
  Full suite: **419/419 tests passing** (24 files — up from Phase 11's
  404), `tsc --noEmit` clean on both the main and renderer project
  configs, and `npm run build` (renderer + main) succeeds.
- **Verified only in the mocked-bridge browser preview** (`npm run
  dev:renderer`; a direct fetch of the served `history.ts` module
  confirmed the live dev server returns the new "Import all…" button/id)
  and in the automated test suite above, which exercises the real
  repository/controller logic against a real temp-directory filesystem but
  a **mocked** Electron `dialog` module (no real Electron binary is
  available in this sandbox). The native Electron open-dialog flow, and
  reading a real end-user-chosen file outside this sandbox, remain
  unverified here and can only be confirmed by running the built app on a
  real machine.
- **No real network/API calls were relevant to or performed for this
  feature** — bulk import is a local-filesystem-only operation with no AI
  provider involved.
- **Not implemented (deliberately out of scope):** drag-and-drop import of
  any kind (single or bulk); any cloud or multi-device sync of exported
  files; any change to the conversation storage/export schema; any
  provider, billing, OS-automation, installer/release, or website/portal
  work (all still out of scope per this phase's own restrictions).

## Scope (Phase 13)

**Drag-and-drop import** — the exact item Phase 12 itself explicitly
considered and deferred ("Drag-and-drop import... was considered and not
selected... better left to its own future phase") and that [Scope (Phase
7)](#scope-phase-7) had separately flagged as unfinished. It is a strict
UI-convenience addition on top of the existing, unchanged import pipeline:
dragging a conversation export file (single `ConversationFileV1` or bulk
`ConversationBulkFileV1`, auto-detected) onto the History list imports it,
as an alternative to the existing "Import…"/"Import all…" buttons — not a
replacement for them.

- **Security design — text, not a path.** The obvious approach (send the
  dropped `File`'s path to the main process, which already owns 100% of
  file I/O) was deliberately **rejected**: a compromised or XSS'd renderer
  could fabricate a `File`-like object with an arbitrary `.path` property
  and trick the main process into reading any file on disk by path, which
  would be a real widening of the file-I/O trust boundary every prior
  phase has kept intact. Instead, the renderer reads the dropped file's
  bytes itself via the standard Web Platform `Blob.prototype.text()` API —
  not a Node/Electron-privileged API, and not forgeable: a script can only
  call `.text()` on a real `File` handle the browser itself granted
  because of an actual OS drag gesture, so it cannot be pointed at an
  arbitrary path like `/etc/passwd`. The renderer then sends the **raw
  text string** (never a path) over a new, narrow IPC channel; the main
  process treats it as completely untrusted content and fully parses/
  validates/saves it with the exact same schema guards
  (`loadConversationFile`, `isValidConversationBulkFile`) every other
  import path already uses, auto-detecting single-vs-bulk shape. The main
  process still performs every actual disk **write**; only the "who reads
  the dropped bytes" step moves to the renderer, via a capability it
  cannot forge.
- **`src/shared/conversation-contract.ts`:** new
  `MAX_DROPPED_IMPORT_TEXT_CHARS` (150,000,000), chosen above the schema's
  own theoretical single-conversation ceiling (2000 messages ×
  60,000 chars ≈ 120,000,000) so this channel is never *more* restrictive
  than the existing, uncapped dialog-based import paths for any file that
  is actually schema-valid — it exists purely as a backstop against
  absurd/unbounded payloads. This is a drag-and-drop-specific safeguard;
  the dialog-based "Import…"/"Import all…" paths remain uncapped, as
  before. Also new: `ConversationImportTextPayload` and
  `isValidImportTextPayload`, which check only the outer shape (non-empty
  string, under the size ceiling) — the actual conversation content is
  validated downstream by the existing single/bulk schema guards, not
  duplicated here.
- **`src/main/conversations/conversationRepository.ts`:** new
  `importAnyFromText(rawText)` — the one conversations repository function
  that does not itself read from disk to get its input. Parses the text as
  JSON, tries the single-conversation schema first, then the bulk schema,
  and rejects anything matching neither. Saves every imported conversation
  one at a time through the existing `saveConversation` path, always under
  a **brand-new id**, giving the exact same no-overwrite, no-collision,
  partial-progress-honesty guarantees `importAllFromFile` already has.
- **`src/main/conversations/conversationsController.ts`:** new
  `importFromTextHandler` — same trusted-sender check as every other
  handler, validates the payload shape with `isValidImportTextPayload`,
  delegates to `repository.importAnyFromText`, and discards the
  `importedCount` the same way `importAllHandler` already does. It is the
  only conversations handler that never opens a native dialog.
- **New IPC channel** `conversationsImportFromText`
  (`axis:conversations:import-from-text`), deliberately named "from-text"
  rather than "from-path" so the trust-boundary difference from every
  other channel is explicit in the code itself. Wired through the preload
  bridge (`importConversationsFromText(text)` in `src/preload/preload.ts`),
  the renderer's type declarations (`src/renderer/ts/global.d.ts`), and a
  matching client wrapper in
  `src/renderer/ts/ai/conversationRepositoryClient.ts`.
- **Renderer (`src/renderer/ts/views/history.ts`):** the existing History
  view's content container becomes a drop target — no new wrapping
  element. `dragenter`/`dragover`/`dragleave` are intercepted (required so
  Chromium doesn't navigate the window away to the dropped file) and only
  acted on when the drag actually carries files (a `dragenter`/`drop` on
  plain text or a link is ignored). A short dashed-border, tinted
  highlight appears while dragging over the list, using existing design
  tokens. On drop, every dropped file is read via `file.text()` and
  imported **sequentially** (so dragging several individually-exported
  conversation files at once works, alongside a single bulk-export file),
  and the list refreshes once if anything succeeded. If one or more files
  fail, only the **first** failure's filename and message are shown — a
  deliberate simplification to keep the error UI to the same single-banner
  pattern every other History action already uses, rather than stacking
  multiple error messages. One short, factual hint line ("You can also
  drag a conversation export file... anywhere in this list to import it")
  was added near the existing Import controls, since drag-and-drop has no
  other visible affordance.
- **No schema change.** `ConversationFileV1` and `ConversationBulkFileV1`
  are both unchanged — this phase only adds a new way to *feed* the same
  formats in.
- **No new dependencies.** Uses only the standard Web `File`/`Blob` API
  already available in Electron's renderer, plus existing IPC/validation
  patterns and design tokens.
- **Tests added this phase:** `isValidImportTextPayload` cases
  (valid, missing/empty/non-string `text`, exactly-at-limit and
  one-over-limit boundary) in `tests/conversation-contract.test.ts`;
  `importAnyFromText` cases (single-detect, bulk-detect, never overwrites
  a colliding id, invalid JSON, invalid shape, empty bulk array) in
  `tests/main/conversationRepository.test.ts`; `importFromTextHandler`
  cases (untrusted-sender rejection, invalid payload shape, successful
  delegation discarding the count, validation-failure propagation) in
  `tests/main/conversationsController.test.ts`; new IPC-channel-count/list
  assertions in `tests/ipc-contract.test.ts`; and new drag-and-drop cases
  in `tests/historyView.test.ts` (single-file drop imports and refreshes,
  multi-file sequential drop, first-failure-only reporting, non-file drags
  ignored, drop-active highlight class toggling) using hand-built
  stand-ins for `DragEvent`/`DataTransfer`/`File` because jsdom (the test
  environment) does not implement `DataTransfer` at all and its `File`
  lacks a working `.text()` method — the stand-ins match the exact shape
  (`dataTransfer.types`, `dataTransfer.files`, `file.name`, `file.text()`)
  the production code actually reads. Full suite: **438/438 tests
  passing** (24 files — up from Phase 12's 419), `tsc --noEmit` clean on
  both the main and renderer project configs, and `npm run build`
  (renderer + main) succeeds.
- **Verified only in the mocked-bridge browser preview** (`npm run
  dev:renderer`; direct fetches of the served `history.ts` and
  `components.css` confirmed the live dev server returns the new drop-hint
  text and the `axis-history-drop-hint`/`axis-view__inner--drop-active`
  CSS classes) and in the automated test suite above, which exercises the
  real repository/controller logic against a real temp-directory
  filesystem and simulates drop events against the real mounted History
  view in jsdom. **Genuine native OS drag-and-drop — physically dragging a
  file from the host OS's file manager onto a real Electron window — is
  not something this sandbox can perform or verify**; that interaction,
  and Electron's own file-drop event delivery, remain unverified here and
  can only be confirmed by running the built app on a real machine.
- **No real network/API calls were relevant to or performed for this
  feature** — drag-and-drop import is a local, renderer-reads/main-
  validates operation with no AI provider involved.
- **Not implemented (deliberately out of scope):** dropping files anywhere
  outside the History view (e.g. onto the AI Workspace); any folder/
  directory drop (only individual files are read, matching the browser's
  own `DataTransfer.files` API); surfacing more than the first failure on
  a multi-file drop; any cloud or multi-device sync; any change to the
  conversation storage/export schema; any provider, billing,
  OS-automation, installer/release, or website/portal work (all still out
  of scope per this phase's own restrictions).

## Scope (Phase 14)

A fourth AI provider — **Mistral AI** — added behind the exact same
`ProviderAdapter` architecture Phase 9 established and Phase 10 already
validated generalizes cleanly. **Provider provenance matters here and is
stated plainly:** the roadmap itself (Phase 9's and Phase 10's own
"not implemented" lists) only ever named the gap vaguely as "any provider
beyond Gemini, OpenAI[, and Anthropic]" — no specific fourth provider was
ever named in this README. That is a genuine ambiguity under this phase's
own "select exactly one next unfinished, explicitly-documented feature; if
the roadmap doesn't clearly identify it, stop and report the ambiguity
before editing" instruction, so it was reported before any file was
touched, and the user explicitly chose **Mistral AI** in response. This
section documents a user decision, not a README-authored target.

- **Architecture validated the premise again.** Re-inspecting
  `aiController.ts`, `credentialStore.ts`, `providerTypes.ts`, and
  `settings.ts` confirmed Phase 10's conclusion still holds at four
  providers, not just three: `PROVIDER_ADAPTERS` is still a
  `Record<AiProviderId, ProviderAdapter>` with no provider-count
  assumption, `credentialStore.ts` is still fully generic over
  `provider: AiProviderId` with no hardcoded list anywhere in it (it
  needed **zero** edits this phase), and `settings.ts`'s provider control
  still builds itself from `AI_PROVIDER_IDS`/`AI_PROVIDER_LABELS`. Adding
  Mistral required no change to the request lifecycle, IPC contracts,
  streaming relay, cancellation, or renderer component structure — only a
  new adapter module, one new import plus one new `PROVIDER_ADAPTERS`
  entry in `aiController.ts`, and completing the one provider-keyed lookup
  table the compiler flagged as incomplete (`COST_NOTES` in
  `settings.ts`, via TypeScript's `Record<AiProviderId, string>`
  exhaustiveness check — the same mechanism Phase 10 relied on).
- **New `src/main/ai/mistralProvider.ts`:** the **Chat Completions API**
  (`POST https://api.mistral.ai/v1/chat/completions`), authenticated with
  a standard `Authorization: Bearer` header (like OpenAI's). Mistral's API
  deliberately mirrors OpenAI's request/response/streaming shape
  (`messages: [{role, content}]`, `choices[0].message.content`/
  `finish_reason`, and SSE `data:` "chunk" events with
  `choices[0].delta.content`, terminated by a literal `data: [DONE]`
  line), so the parsing logic reads very similarly to
  `openaiProvider.ts` — but the module is still fully self-contained,
  matching the established one-module-per-provider convention, and shares
  no request/response parsing with any other provider module. Default
  model `mistral-small-latest`, chosen for the same "fast, cheap, widely
  available" reasoning Phase 9/10 used for OpenAI's `gpt-4o-mini` and
  Anthropic's `claude-haiku-5-5`. `GET /v1/models` is used for **Test
  connection** (non-billable, same policy as the other three providers).
  Two real differences from OpenAI are handled explicitly rather than
  assumed away: Mistral's error body is **flatter** (`{message, type,
  code}`, no nested `error` key), and Mistral returns **HTTP 422** (not
  400) for request-validation failures — `classifyMistralError` in
  `mistralProvider.ts` special-cases both before falling back to the
  shared `classifyHttpError` helper every other provider also uses.
  **Sandbox disclosure:** this sandbox has no outbound network access to
  `api.mistral.ai` (only `github.com`/`npmjs.org`/`pypi.org` and their
  CDNs are reachable), so every fact above about Mistral's exact request/
  response/SSE/error shape was gathered via web search against public,
  secondary documentation/discussion sources rather than a live fetch of
  Mistral's own docs site or a real API call — this is stated honestly
  rather than implied to be independently verified against the live API.
- **`src/shared/ai-contract.ts`:** `AiProviderId` extended to
  `"gemini" | "openai" | "anthropic" | "mistral"`; `AI_PROVIDER_IDS` and
  `AI_PROVIDER_LABELS` (label: `"Mistral"`, the same "recognizable product
  name" convention as `"Gemini"`/`"Claude"`) gained the new entry;
  `isValidProviderId` now accepts it. No other shared type changed shape —
  `resolveProviderId` still defaults anything unrecognized to `"gemini"`,
  exactly as it did in Phase 9/10.
- **`src/main/ai/aiController.ts`:** one new import and one new
  `PROVIDER_ADAPTERS.mistral` entry. No other line in this file changed —
  the validation order (provider id checked before any adapter is ever
  touched), single-flight tracking, timeout/cancel wiring, and the
  streaming relay are unchanged and apply identically to Mistral.
- **Settings UI:** no new markup was written. `AI_PROVIDER_IDS.map(...)`
  already building the segmented control from the shared id list meant
  Mistral simply appeared as a fourth option; only the provider-keyed
  `COST_NOTES` copy table needed a new entry.
- **Home and AI Workspace, conversation history, export/import schemas:
  unchanged**, for the same reason Phase 9/10 didn't need to touch them —
  provider selection is a Settings-level, per-request concern.
- **Test-placeholder cleanup.** Several existing tests
  (`tests/ai-contract.test.ts`, `tests/main/aiController.test.ts`) used the
  literal string `"mistral"` as their canonical example of an
  *unsupported* provider id, left over from before this phase existed.
  Now that Mistral is real, every one of those assertions was updated to
  use `"cohere"` instead (a real, named, but still-unimplemented provider
  — consistent with the existing "known but deliberately out of scope"
  placeholder style), and a corresponding **positive** assertion for
  `"mistral"` as a valid, correctly-isolated provider was added next to
  each one.
- **Tests added this phase:** new `tests/main/mistralProvider.test.ts`
  (23 tests: Bearer-auth headers never leaking the key into the URL,
  success/truncated(`finish_reason: "length"`)/malformed/non-JSON-body
  response parsing, HTTP 401/429/5xx/network-exception/abort → the correct
  normalized error code, **HTTP 422 → `VALIDATION_ERROR`** specifically
  (Mistral's distinguishing behaviour vs. OpenAI's 400), AXIS "model" →
  Mistral "assistant" history-role mapping, `GET /models` test-connection
  with Bearer auth, and real SSE streaming — multi-delta accumulation,
  `[DONE]` termination, truncated/`length` finish reason, a single
  malformed event skipped without aborting the stream, a mid-stream HTTP
  error, and a genuine mid-stream `AbortController` cancellation — all
  against mocked `fetch`/SSE responses, exactly like the existing Gemini/
  OpenAI/Anthropic provider test files); a new four-provider isolation
  test in `tests/main/credentialStore.test.ts` (independent
  `mistral.cred` file, independent status, independent key lookup,
  removal leaves the other three providers' credentials untouched); new
  Mistral-specific dispatch tests in `tests/main/aiController.test.ts`'s
  multi-provider describe block (send/stream routing, independent
  credential lookup across all four providers in one test, test-connection
  routing, credential-handler forwarding — mirroring the existing
  Anthropic cases); new Mistral cases in `tests/settingsProvider.test.ts`
  (the segmented control offers Mistral as a fourth option, switching to
  it persists/refetches status scoped to `"mistral"`, and it is never
  shown as connected prematurely); and updated `tests/ai-contract.test.ts`
  cases (all four now-valid provider ids positively asserted, with
  `"cohere"` as the new negative-path placeholder in every rejection
  assertion). Full suite: **469/469 tests passing** (25 files — up from
  Phase 13's 438), `tsc --noEmit` clean on both the main and renderer
  project configs, and `npm run build` (renderer + main) succeeds.
- **Verified only in the mocked-bridge automated test suite above** — i.e.
  that the provider control offers Mistral correctly, and that
  request/response/streaming/error-handling logic behaves correctly
  against **mocked** HTTP/SSE responses built from Mistral's
  publicly-documented (via web search, not a live fetch — see the
  sandbox-disclosure note above) request/response/error shapes. **No real
  Mistral (or OpenAI/Anthropic/Gemini) API request was made or could be
  made in this sandbox** (no outbound network access to `api.mistral.ai`),
  so genuine end-to-end connectivity against Mistral's live API, and the
  native Electron `safeStorage`/OS-keychain credential-persistence path,
  remain unverified here and can only be confirmed by running the built
  app on a real machine with a real Mistral API key. The renderer build
  was also smoke-checked via `npm run dev:renderer`-style production
  `vite build` output only (no interactive browser-preview session was
  run this phase beyond the build artifact itself); the Settings segmented
  control's fourth "Mistral" option and its behaviour are otherwise
  confirmed by the jsdom-based `tests/settingsProvider.test.ts` cases
  above, not a manual click-through.
- **Not implemented (deliberately out of scope):** any provider beyond
  Gemini, OpenAI, Anthropic, and Mistral; payments/subscriptions/
  accounts/cloud sync/marketplace features; unrestricted shell/OS
  automation; an installer/release build; a Founder/Developer Portal or
  cross-product integration; or any change to the conversation storage/
  export schema. Nothing from Phases 1–13 was refactored or had its
  behaviour changed; only the four files listed above were edited, plus
  the test files listed above and this README.

## Scope (Phase 15)

**Surfacing every failure (not just the first) on a multi-file
drag-and-drop import** — an item Phase 13 explicitly named in its own
"not implemented (deliberately out of scope)" list:
*"surfacing more than the first failure on a multi-file drop"*. This is
the only item left in that same list that is both unambiguous and not
already forbidden by this phase's own standing restrictions — the other
two items in that list (dropping files outside the History view, and
folder/directory drops) either require an undefined product decision
(what should a drop onto the AI Workspace *do* — import to History, open
the result, both?) or cut against the existing security model (reading an
entire folder tree is a materially larger renderer-reads-content surface
than a handful of individually-granted `File` handles), so neither is a
clean, bounded fit for "implement exactly one feature completely within
its documented scope." Every other remaining "not implemented" item
anywhere in this README (a fifth AI provider, payments/accounts/cloud
sync/marketplace, OS/shell automation, an installer/release build, a
Founder/Developer Portal) is explicitly forbidden by this phase's own
restrictions, so this was the one clearly eligible, narrowly-scoped item
left.

- **`src/renderer/ts/views/history.ts` — `handleDroppedFiles` (Phase 13)
  changed, nothing else in the file did.** The function now collects every
  per-file failure into an array instead of remembering only the first
  one, and a new `formatDropFailures` helper renders them into the exact
  same single-paragraph error banner the view already uses for every
  other History action's failure state (no new UI component, no stacked
  banners, no new CSS): a lone failure still reads exactly as it did
  before (`"<name>: <reason>"`), and two or more are prefixed with an
  explicit `"N of M files could not be imported"` count so a partial
  failure is never mistaken for a total one. To keep that one paragraph
  bounded for an unusually large drop, at most `MAX_DROP_FAILURE_DETAILS`
  (3) failures are named individually; any remaining ones are summarized
  as `"(and N more)"` rather than growing the banner without limit.
- **Deterministic ordering, fixed as part of the same change.** The
  previous code kicked off `refresh()` (to show any successful imports)
  without awaiting it, then immediately rendered the first-failure error
  on top — so whichever of the two un-ordered async operations resolved
  last silently won the final view, with no test covering that interleaving
  either way. `handleDroppedFiles` now `await`s the refresh before ever
  rendering a failure, so the outcome is deterministic: successful imports
  are always saved and folded into the list first, and if there was also
  at least one failure, the error banner (now listing every failure) is
  what the user sees last — the same "most recent outcome wins the view"
  convention every other History action (rename/delete/export/import)
  already follows, not a new display pattern.
- **No schema, IPC, or security-boundary change.** This phase touches only
  renderer-side aggregation/formatting of messages the main process
  already returns; `importConversationsFromText`, the IPC channel, the
  trusted-sender check, and every validator in
  `conversation-contract.ts`/`conversationRepository.ts` are completely
  unchanged. The renderer still never reads a dropped file by path — only
  `file.text()` on a real, browser-granted `File` handle, exactly as
  Phase 13 established.
- **No new dependencies.** Pure logic/formatting change inside an existing
  function, using the same design tokens and `axis-empty-state` markup
  every other History error state already uses.
- **Tests added/updated this phase**
  (`tests/historyView.test.ts`, drag-and-drop describe block): the
  existing "reports only the first failure" test was renamed and updated
  to assert **both** failures now appear; new cases cover a single-file
  failure keeping the original unprefixed `"name: reason"` shape (no
  `"of 1 files"` count), a five-file failure drop capping the named detail
  at 3 and summarizing the rest as `"(and 2 more)"`, and a partial-success
  drop ending deterministically on the failure banner while confirming the
  successful import was still saved and the list still refreshed
  (an increased `list()` call count) before that banner was shown. Full
  suite: **472/472 tests passing** (25 files — up from Phase 14's 469),
  `tsc --noEmit` clean on both the main and renderer project configs
  (including fixing one new strict `noUncheckedIndexedAccess` diagnostic
  introduced by this phase's own code, not a preexisting one), and
  `npm run build` (renderer + main) succeeds.
- **Verified only in the automated test suite above**, which simulates
  real multi-file `drop` events (with hand-built `DragEvent`/`File`
  stand-ins, the same approach Phase 13 used, since jsdom does not
  implement a working `DataTransfer`/`File.text()`) against the real
  mounted History view and a real (in-memory, mocked-IPC) conversations
  bridge. **Genuine native OS drag-and-drop of several files at once from
  a real file manager onto a real Electron window is not something this
  sandbox can perform or verify** — that interaction remains unverified
  here and can only be confirmed by running the built app on a real
  machine, exactly as Phase 13 already disclosed. The production
  `vite build` output was also confirmed to contain the updated
  `history.ts` bundle; no separate interactive browser-preview click-through
  was performed this phase beyond that build check and the automated
  jsdom-based tests above.
- **No real network/API calls were relevant to or performed for this
  feature** — this is a local, renderer-formats/main-validates operation
  with no AI provider involved, identical in that respect to Phase 13.
- **Not implemented (deliberately out of scope, same restrictions as every
  prior phase):** dropping files anywhere outside the History view (e.g.
  onto the AI Workspace); any folder/directory drop; any cloud or
  multi-device sync; any change to the conversation storage/export schema;
  any provider, payments/subscriptions/billing/accounts/cloud
  sync/marketplace, unrestricted shell/OS automation, installer/release,
  or Founder/Developer-Portal/cross-product-integration work. Nothing from
  Phases 1–14 was refactored or had its behaviour changed; only
  `src/renderer/ts/views/history.ts`, `tests/historyView.test.ts`, and
  this README were edited.

## Scope (Phase 16)

- **Feature selected: window-wide drag-and-drop import.** Phases 1–15 closed
  every other documented roadmap gap (see each phase's own "Not implemented"
  list above); the only two items still open going into this phase were both
  from Phase 13/15's own deferred list — (1) dropping a conversation export
  file anywhere in the window, not just onto the History view's own list,
  and (2) folder/directory drop support. Neither is forbidden, but neither
  is unambiguously "next" either (both were explicitly left open-ended by
  Phase 15 rather than sequenced). Per this phase's instructions, that
  genuine ambiguity was surfaced to the user with both options (plus
  "conclude no feature remains" and "something else") rather than guessed
  at. **The user explicitly chose window-wide drop import**, with this
  exact framing: *"Make drag-and-drop import work from any view (not just
  History), reusing History's existing import pipeline. Dropping a file
  anywhere navigates to History to show the result (success refresh or
  error banner) — no new toast/notification UI component is introduced."*
  Folder/directory drop remains open and unselected (see "Not implemented"
  below) — it was not chosen and is not part of this phase.
- **What changed:**
  - `src/renderer/ts/dragDropFiles.ts` (new) — the one-line "does this drag
    actually carry a file" check, previously private to the History view,
    extracted into its own tiny shared module so both the History view and
    the new window-wide handler use exactly the same definition rather than
    two copies of the same check drifting apart.
  - `src/renderer/ts/state.ts` — added `pendingDroppedFiles: FileList | null`
    to the store's state (mirroring the existing
    `pendingOpenConversationId` field used for the AI Workspace's "open a
    conversation from History" flow) plus two methods:
    `requestImportDroppedFiles(files)` (switches to the History view and
    records the dropped `FileList`) and `clearPendingDroppedFiles()`
    (clears it once History has finished processing it). No new IPC, no new
    persisted setting — this is purely in-memory renderer state, exactly
    like its Workspace counterpart.
  - `src/renderer/ts/app.ts` — added four drag-event listeners
    (`dragenter`/`dragover`/`dragleave`/`drop`) on the app shell's root
    element. They ignore any drag that does not carry a file (reusing the
    shared `dragCarriesFiles` check), show a window-wide highlight while a
    file is being dragged over the shell, and on drop call
    `store.requestImportDroppedFiles(files)` — nothing else; **all actual
    file reading, validation, import-client calls, and success/failure
    rendering are still done entirely by History's existing
    `handleDroppedFiles`, `formatDropFailures`, and `MAX_DROP_FAILURE_DETAILS`
    from Phase 13/15, reused as-is and not duplicated.**
  - `src/renderer/ts/views/history.ts` — (1) now imports `dragCarriesFiles`
    from the new shared module instead of defining its own private copy;
    (2) its own four drop-zone listeners now call `event.stopPropagation()`
    in addition to their existing `preventDefault()`, so a drop that lands
    inside History's own list is fully handled there and is never also seen
    by the new window-wide listener on the shell (this is what prevents a
    drop inside History from being double-imported now that a second,
    broader listener also exists — see the dedicated regression test
    below); (3) added a `store.subscribe` block that watches
    `pendingDroppedFiles`, guards against re-entrancy with a local boolean
    exactly like the Workspace view already does for
    `pendingOpenConversationId`/`openingConversationId`, calls the same
    `handleDroppedFiles` used by its own drop zone, and only calls
    `store.clearPendingDroppedFiles()` once that import has fully settled;
    (4) updated the existing drop-hint copy in the History view to mention
    the feature now also works anywhere in the AXIS window.
  - `src/renderer/styles/layout.css` — added `.axis-app.axis-app--drop-active`,
    the window-wide counterpart to History's existing
    `.axis-view__inner--drop-active` highlight. It deliberately uses an
    *inset* `box-shadow` rather than an `outline`/`outline-offset` (which is
    what History's own, smaller highlight uses): `.axis-app` is exactly
    `100vw` × `100vh`, so an offset outline would be clipped at the window's
    edge, whereas an inset shadow is never clipped there.
  - **No new toast or notification UI component was introduced**, per the
    user's explicit constraint — a drop anywhere in the window simply
    navigates to the already-existing History view, which shows the same
    success (list refresh) or failure (error banner, with the same
    per-file failure formatting introduced in Phase 15) states it already
    had.
- **Tests added** (all new, nothing removed or weakened):
  - `tests/state.test.ts` — 4 new tests: the default `pendingDroppedFiles`
    is `null`; `requestImportDroppedFiles` switches to History and records
    the file list (including when another view was active); `clearPendingDroppedFiles`
    clears it and is idempotent (no extra notifications on a second call).
  - `tests/historyView.test.ts` — 6 new tests under a
    "window-wide drag-and-drop import (Phase 16)" block (the pre-existing
    `makeFakeDroppedFile`/`dispatchDragEvent` test helpers were hoisted out
    of the Phase 13 block to module scope so both blocks share them, with
    no behavioural change to any existing test — all 34 pre-existing drag
    tests in this file still pass unmodified): a file dropped on the Home
    view is imported and the app switches to History to show it; an
    invalid file dropped from Settings navigates to History and shows the
    same per-file failure banner as a native History drop; a non-file drag
    from another view is ignored (no import call, no navigation); the
    window-wide highlight class toggles correctly outside History; the
    window-wide highlight is **not** applied for a drag that stays inside
    History's own drop zone (confirming `stopPropagation` is working); and
    a dedicated **regression test** confirming a drop that lands inside
    History's own zone is still imported *exactly once* (not twice) now
    that a second, window-wide listener also exists on the shell.
  - `tests/app.test.ts` — 3 new tests under a
    "window-wide drag-and-drop (Phase 16)" block, run (like every other
    test in this file) with no `window.axis` bridge installed at all, i.e.
    the plain browser-preview scenario: the shell-wide highlight toggles on
    drag enter/leave; a non-file drag is fully ignored; and a drop still
    navigates to History and shows History's own pre-existing "run the
    desktop app" no-native-bridge error state (confirming the window-wide
    path does not crash or silently swallow the case where there is no
    Electron bridge at all).
  - Full suite: **485/485 tests passing** (472 pre-existing + 13 new; zero
    regressions, zero skipped, zero modified assertions in any pre-existing
    test).
- **TypeScript:** `npm run typecheck` (both `tsconfig.main.json` and
  `tsconfig.renderer.json`) passes with zero errors.
- **Build:** `npm run build` (Vite renderer bundle + `tsc` main-process
  build) succeeds with no errors or new warnings.
- **Verified only in the automated test suite and a production build
  check above**, which simulates `dragenter`/`dragover`/`dragleave`/`drop`
  events (the same hand-built `DragEvent`/`File` stand-ins Phase 13 and 15
  already used, since jsdom does not implement a working
  `DataTransfer`/`File.text()`) against the real mounted app shell, the
  real History view, and a real (in-memory, mocked-IPC) conversations
  bridge. **Genuine native OS drag-and-drop from a real file manager onto a
  real Electron window — anywhere in the window, not just over the History
  list — is not something this sandbox can perform or verify.** That
  interaction remains unverified here and can only be confirmed by running
  the built app on a real machine, exactly as Phases 13 and 15 already
  disclosed for History's own drop zone.
- **No real network/API calls were relevant to or performed for this
  feature** — like Phase 13/15, this is a purely local,
  renderer-formats/main-validates operation with no AI provider involved.
  It also introduces **no new IPC surface and no new trust boundary**: the
  window-wide handler never reads a file path, only ever calls the
  browser's `File.text()` on files the user already explicitly dragged in
  (exactly the same mechanism, and the same trust boundary, as History's
  own Phase 13 drop handling).
- **Not implemented (deliberately out of scope, same restrictions as every
  prior phase):** folder/directory drop (explicitly considered and not
  selected this phase — remains an open, non-selected option if ever
  revisited); any cloud or multi-device sync; any change to the
  conversation storage/export schema; any new toast/notification UI (the
  user explicitly excluded this); any provider,
  payments/subscriptions/billing/accounts/cloud sync/marketplace,
  unrestricted shell/OS automation, installer/release, or
  Founder/Developer-Portal/cross-product-integration work. Nothing from
  Phases 1–15 was refactored or had its behaviour changed beyond the
  `stopPropagation()` addition to History's own drop-zone listeners
  (necessary so a drop landing there is never double-handled by the new
  window-wide listener, and covered by a dedicated regression test); only
  `src/renderer/ts/app.ts`, `src/renderer/ts/state.ts`,
  `src/renderer/ts/views/history.ts`, the new
  `src/renderer/ts/dragDropFiles.ts`, `src/renderer/styles/layout.css`,
  `tests/state.test.ts`, `tests/historyView.test.ts`, `tests/app.test.ts`,
  and this README were touched.

## Scope (Phase 17)

- **Feature selected: folder/directory drop support for conversation
  import.** A full re-audit of every phase's own "Not implemented" list
  (Phases 5 through 16) found that every other previously-deferred item is
  now either closed by a later phase or explicitly forbidden by the
  standing restrictions (payments/accounts/cloud sync/marketplace,
  unrestricted shell/OS automation, installer/release,
  Founder/Developer-Portal/cross-product work). The **one** item still
  open, named repeatedly and consistently across Phase 13, 15, and 16's own
  "Not implemented" lists, and explicitly flagged by Phase 16 as
  *"remains an open, non-selected option if ever revisited"*, is
  **folder/directory drop** — i.e. dropping an entire folder of exported
  conversation files (instead of selecting the files individually) and
  having every file inside it imported the same way a flat multi-file drop
  already is. This phase selects and implements exactly that one item, per
  the instruction to prefer the next eligible, already-documented item in
  sequence rather than inventing new scope.
- **What changed:**
  - `src/renderer/ts/dragDropFiles.ts` — added `expandDroppedEntries()`,
    which turns a drop's `DataTransfer` into a flat `File[]`, transparently
    expanding any dropped folder into the files it contains (recursing into
    nested subfolders of any depth, paging through the directory reader
    exactly as its contract requires). It relies on each
    `DataTransferItem`'s `webkitGetAsEntry()` — non-standard in name but
    supported by every Chromium build, and therefore by Electron, the only
    runtime AXIS ships on. Where that API is unavailable, it falls back to
    the plain `dataTransfer.files` list AXIS already used before this
    phase, so behaviour for a plain (non-folder) drop is completely
    unchanged. A file inside a folder that fails to be read (a rare
    filesystem-level error) is skipped rather than aborting the whole
    folder's import, consistent with the existing per-file failure
    tolerance introduced in Phase 15.
  - `src/renderer/ts/views/history.ts` — its own drop zone now calls
    `expandDroppedEntries()` before handing files to the existing
    `handleDroppedFiles`, so dropping a folder directly onto History's list
    works exactly like dropping its files individually would have. No
    import, validation, or failure-reporting logic was duplicated or
    changed — `handleDroppedFiles` (Phase 13/15), `formatDropFailures`, and
    `MAX_DROP_FAILURE_DETAILS` are reused exactly as they were, now simply
    fed a (possibly folder-expanded) `File[]` instead of a raw `FileList`.
    The drop-hint copy was updated to mention folders are supported too.
  - `src/renderer/ts/app.ts` — the Phase 16 window-wide drop handler now
    also calls `expandDroppedEntries()` before calling
    `store.requestImportDroppedFiles(...)`, so a folder dropped anywhere in
    the window (not just onto History's own list) is expanded and imported
    the same way.
  - `src/renderer/ts/state.ts` — `pendingDroppedFiles` and
    `requestImportDroppedFiles(...)` now use a plain `File[]` instead of
    the raw `FileList` a drop event itself carries, since folder expansion
    always produces a plain array; this is an internal type change only,
    with no behavioural effect on anything else in the store.
  - **No new UI component, dialog, or settings toggle was added** — folder
    drop reuses the exact same visual affordances (the drop-zone highlight,
    the drop hint text, and History's existing success/error states) that
    flat multi-file drop already had.
- **Tests added** (all new, nothing removed or weakened):
  - `tests/dragDropFiles.test.ts` (new file) — 14 focused unit tests for
    `expandDroppedEntries()` and `dragCarriesFiles()` against fake
    `FileSystemEntry`/`FileSystemDirectoryEntry` objects: plain-file
    fallback when no folder-entry API is available; a single dropped file;
    a folder's direct contents; nested subfolders at multiple depths; a
    directory reader that pages its results across several `readEntries()`
    calls (per the API's actual contract); a mix of plain files and folders
    dropped together; a file inside a folder that fails to be read being
    skipped without throwing; a `null` entry being ignored; and `null`/
    `undefined` `dataTransfer` inputs.
  - `tests/historyView.test.ts` — 4 new integration tests under a
    "folder/directory drop import (Phase 17)" block, exercising the real
    mounted History view and the real window-wide handler together with a
    real (in-memory, mocked-IPC) conversations bridge: every file inside a
    dropped folder is imported when dropped directly onto History's own
    zone; nested subfolders are recursed into and their files imported;
    a non-export file found inside a dropped folder produces the same
    per-file failure banner a direct bad-file drop already does; and a
    dropped folder is expanded and imported correctly when it lands
    somewhere other than History (the window-wide path from Phase 16).
  - Full suite: **503/503 tests passing** (485 pre-existing + 18 new; zero
    regressions). One pre-existing assertion
    (`tests/historyView.test.ts`'s single-file drop import test) had its
    `flush()` tick budget increased to account for the one extra
    microtask hop `expandDroppedEntries` now always introduces before a
    drop is processed — its assertions and behaviour are unchanged.
- **TypeScript:** `npm run typecheck` (both `tsconfig.main.json` and
  `tsconfig.renderer.json`) passes with zero errors. The File and Directory
  Entries API types used (`FileSystemEntry`, `FileSystemDirectoryEntry`,
  `FileSystemFileEntry`, `DataTransferItem.webkitGetAsEntry`) are already
  part of the standard TypeScript DOM library already in use — no new
  dependency or `types` addition was needed.
- **Build:** `npm run build` (Vite renderer bundle + `tsc` main-process
  build) succeeds with no errors or new warnings.
- **Verified only in the automated test suite and a production build
  check above**, using hand-built fake `FileSystemEntry`/
  `FileSystemDirectoryEntry`/`DataTransferItem` stand-ins (jsdom, this
  project's test environment, does not implement the real File and
  Directory Entries API any more than it implements a working
  `DataTransfer`/`File.text()`, which is why every drag-and-drop test in
  this project — Phase 13, 15, 16, and now 17 — has always used hand-built
  stand-ins rather than the real browser API). **Genuine native OS
  drag-and-drop of a real folder from a real file manager onto a real
  Electron window is not something this sandbox can perform or verify.**
  That interaction, and whether real-world Chromium's `webkitGetAsEntry()`
  behaves exactly as MDN documents it, remain unverified here and can only
  be confirmed by running the built app on a real machine — the same
  standing limitation every prior phase has already disclosed for its own
  drag-and-drop work.
- **No real network/API calls were relevant to or performed for this
  feature** — like Phase 13/15/16, this is a purely local,
  renderer-formats/main-validates operation with no AI provider involved.
  It also introduces **no new IPC surface and no new trust boundary**: the
  folder-expansion step still only ever calls browser File APIs
  (`webkitGetAsEntry()`, `FileSystemDirectoryReader.readEntries()`,
  `FileSystemFileEntry.file()`) on items the user already explicitly
  dragged in, and the resulting files still only ever reach the main
  process through the exact same validated `importConversationsFromText`
  IPC call every other drop already used — never a raw filesystem path.
- **Not implemented / known limitations (deliberately out of scope, same
  restrictions as every prior phase):** no artificial cap on folder size or
  recursion depth — a very large folder will attempt to import every file
  it contains (and, as already happened for a large flat multi-file drop
  since Phase 15, the individually-named failure list is still capped by
  `MAX_DROP_FAILURE_DETAILS` with an "and N more" summary); every file
  found inside a folder is attempted through the same validator regardless
  of file type, so a folder containing many non-export files (e.g. stray
  OS metadata files) will simply show up as that many failures, exactly as
  if they had all been dropped individually — no filtering by extension or
  name was added, to avoid inventing new, unrequested product behaviour;
  any cloud or multi-device sync; any change to the conversation storage/
  export schema; any new toast/notification UI; any provider,
  payments/subscriptions/billing/accounts/cloud sync/marketplace,
  unrestricted shell/OS automation, installer/release, or
  Founder/Developer-Portal/cross-product-integration work. Nothing from
  Phases 1–16 was refactored or had its behaviour changed beyond the
  type-only `FileList` → `File[]` adjustment described above; only
  `src/renderer/ts/dragDropFiles.ts`, `src/renderer/ts/state.ts`,
  `src/renderer/ts/views/history.ts`, `src/renderer/ts/app.ts`, the new
  `tests/dragDropFiles.test.ts`, `tests/historyView.test.ts`, and this
  README were touched.

## Scope (Phase 18)

- **Feature selected: bounded recursion depth and total file-count caps for
  folder/directory drop import.** A full re-audit of every phase's own
  "Not implemented"/roadmap lists (Phases 1 through 17) found the
  documented, authorized feature track exhausted: every other item is now
  either already implemented, closed by a later phase, or explicitly
  forbidden by the standing restrictions (payments/accounts/cloud sync/
  marketplace, unrestricted shell/OS automation, installer/release,
  Founder/Developer-Portal/cross-product work). The only remaining,
  explicitly-named open item was Phase 17's own disclosed limitation:
  *"no artificial cap on folder size or recursion depth — a very large
  folder will attempt to import every file it contains"*. Because this is
  a hardening of an already-shipped feature rather than a new,
  independently-documented roadmap entry, it was **not** assumed to be
  automatically in scope; it was surfaced to the user as a choice (via the
  question/options mechanism) alongside the alternative of stopping with no
  eligible feature left, and the user explicitly chose and authorized
  hardening this exact limitation as Phase 18's task. This phase selects
  and implements exactly that, per the instruction to prefer resolving the
  next eligible, already-documented, user-authorized item rather than
  inventing new scope.
- **What changed:**
  - `src/renderer/ts/dragDropFiles.ts` — added two exported constants,
    `MAX_FOLDER_RECURSION_DEPTH = 12` and `MAX_FOLDER_EXPANDED_FILES = 500`,
    and changed `expandDroppedEntries()`'s return type from a plain
    `File[]` to `DroppedEntriesExpansion`, an object of
    `{ files: File[]; truncatedByFileCount: boolean; truncatedByDepth: boolean }`.
    The internal recursive walk (`collectFilesFromEntry`) now carries a
    running depth counter and a shared mutable counter of files collected
    so far; it refuses to descend into a folder once the walk has reached
    `MAX_FOLDER_RECURSION_DEPTH` levels of nesting (setting
    `truncatedByDepth`), and stops collecting further files for the whole
    drop (across every top-level dropped folder, not per-folder) once
    `MAX_FOLDER_EXPANDED_FILES` have already been collected (setting
    `truncatedByFileCount`). Either cap being hit stops *further*
    expansion but never discards files already found — a drop that hits a
    cap still imports everything collected up to that point, consistent
    with the existing "skip what fails, keep going" tolerance from Phase
    15 onward. A new exported `buildFolderExpansionNotices(expansion)`
    turns the two boolean flags into 0–2 short, user-facing sentences
    (e.g. "Only the first 500 files were imported from the dropped
    folder(s)." / "A folder nested more than 12 levels deep was skipped."),
    kept in this module so the wording lives next to the limits it
    describes.
  - **The plain `dataTransfer.files` fallback path (used when the
    non-standard File and Directory Entries API is unavailable) is
    deliberately left uncapped.** That path was already a flat, flat
    browser-supplied list before this phase — it is never recursively
    walked, so neither cap is meaningful there, and capping it would only
    silently drop files from an ordinary flat multi-file drop with no
    folder involved at all, which is not the limitation this phase was
    authorized to address. This is documented inline in the source.
  - `src/renderer/ts/views/history.ts` — a new `buildDropResultMessage
    (failures, notices, totalFiles)` sits next to the existing
    `formatDropFailures`, combining real per-file import failures with any
    folder-expansion cap notices into the one existing error banner —
    **no new UI element was added**, this reuses History's current
    error-state rendering exactly as Phase 13–17 already did.
    `handleDroppedFiles` now accepts an optional `notices: string[]`
    parameter and folds it into that combined message. Both of History's
    drop entry points — its own drop-zone listener and the
    `pendingDroppedFiles` store subscription that receives drops forwarded
    from elsewhere in the window — now read `expandDroppedEntries()`'s new
    object shape, compute notices via `buildFolderExpansionNotices`, and
    pass them through.
  - `src/renderer/ts/state.ts` — added `pendingDroppedFileNotices: string[]`
    (default `[]`) alongside the existing `pendingDroppedFiles` field, so
    a folder dropped via the window-wide handler can carry its cap notices
    across to History the same way its files already did.
    `requestImportDroppedFiles(files, notices = [])` and
    `clearPendingDroppedFiles()` were updated accordingly; this is an
    additive, internal store change only.
  - `src/renderer/ts/app.ts` — the window-wide drop handler now reads
    `expandDroppedEntries()`'s new return shape and passes the computed
    notices into `store.requestImportDroppedFiles(...)`.
  - **No new UI component, dialog, toast, or settings toggle was added** —
    folder-expansion caps surface exclusively through the same error
    banner / `formatDropFailures` pipeline every prior drag-and-drop phase
    already used.
- **Tests added** (all new, nothing removed or weakened):
  - `tests/dragDropFiles.test.ts` — existing assertions updated to read
    `result.files` instead of treating the resolved value as the array
    itself (a pure test-shape update, no behavioural change to those
    cases); added a `"expandDroppedEntries folder-expansion limits
    (Phase 18)"` block with 6 new tests: exceeding the file-count cap and
    truncating at exactly `MAX_FOLDER_EXPANDED_FILES`; the cap being shared
    across multiple folders dropped together rather than reset per folder;
    the exact-cap boundary producing no false truncation; a folder nested
    deeper than `MAX_FOLDER_RECURSION_DEPTH` being skipped and reported;
    a shallow file still being collected when a sibling deep branch is
    skipped; and the exact-depth boundary producing no false truncation.
    Added a `"buildFolderExpansionNotices (Phase 18)"` block with 4 tests
    covering the empty/file-count/depth/both-notices cases.
  - `tests/state.test.ts` — 4 new tests covering the default empty
    `pendingDroppedFileNotices`, `requestImportDroppedFiles` defaulting to
    no notices, `requestImportDroppedFiles` recording supplied notices
    alongside the files, and `clearPendingDroppedFiles` clearing both
    fields together.
  - `tests/historyView.test.ts` — the three small folder-entry test
    helpers (`fakeFileEntry`, `fakeDirectoryEntry`, `dispatchFolderDrop`)
    used by Phase 17's tests were hoisted to module scope (no behavioural
    change) so a new `"folder-expansion limits (Phase 18)"` block of 4
    integration tests could reuse them against the real mounted app: a
    folder with more than `MAX_FOLDER_EXPANDED_FILES` files still imports
    exactly the cap's worth and shows the file-count notice, dropped
    directly on History's own zone; a folder nested one level deeper than
    `MAX_FOLDER_RECURSION_DEPTH` imports nothing from that branch and shows
    the depth notice; the file-count case is also verified through the
    window-wide drop handler (not just History's own zone); and a real
    per-file validation failure together with a depth-cap notice are both
    shown together in the one combined banner. These tests exercise the
    real several-hundred-file and several-level-deep walk end-to-end
    rather than only the unit-level `expandDroppedEntries` function.
  - Full suite: **521/521 tests passing** (503 pre-existing + 18 new; zero
    regressions).
- **TypeScript:** `npm run typecheck` (both `tsconfig.main.json` and
  `tsconfig.renderer.json`) passes with zero errors.
- **Build:** `npm run build` (Vite renderer bundle + `tsc` main-process
  build) succeeds with no errors or new warnings.
- **Verified only in the automated test suite and a production build
  check above**, using hand-built fake `FileSystemEntry`/
  `FileSystemDirectoryEntry`/`DataTransferItem` stand-ins, the same
  approach every drag-and-drop test in this project (Phase 13, 15, 16, 17,
  and now 18) has used since jsdom does not implement the real File and
  Directory Entries API. **Genuine native OS drag-and-drop of a real,
  very large or very deeply nested folder from a real file manager onto a
  real Electron window is not something this sandbox can perform or
  verify.** Whether real-world Chromium's `webkitGetAsEntry()`/
  `FileSystemDirectoryReader` behave exactly as modeled by these fakes
  under those extreme conditions remains unverified here and can only be
  confirmed by running the built app on a real machine — the same standing
  limitation every prior drag-and-drop phase has already disclosed.
- **No real network/API calls were relevant to or performed for this
  feature** — like Phase 17, this is a purely local, renderer-side
  bookkeeping change with no AI provider involved, no new IPC surface, and
  no new trust boundary: the caps only limit how many already-locally-read
  `File` objects are handed to the exact same validated
  `importConversationsFromText` IPC call every prior drop already used.
- **Security rationale:** without a bound, a user dropping an
  accidentally-huge or maliciously-crafted folder (e.g. a deeply
  self-referential or very wide directory tree) could cause the renderer
  to attempt to read and queue an unbounded number of files before any
  feedback is shown, as a pure availability/responsiveness concern local
  to the user's own machine (not a sandbox-escape or data-exfiltration
  risk, since the feature still never touches raw filesystem paths or the
  main process beyond the existing validated import call). Capping both
  the recursion depth and the total file count turns that into a bounded,
  predictable worst case with clear user-facing feedback, while still
  importing everything found up to the cap rather than failing the whole
  drop.
- **Not implemented / known limitations (deliberately out of scope, same
  restrictions as every prior phase):** the two cap values
  (`MAX_FOLDER_RECURSION_DEPTH = 12`, `MAX_FOLDER_EXPANDED_FILES = 500`)
  are fixed constants, not user-configurable (no settings UI was added,
  consistent with the "no new UI" constraint); "nested more than 12 levels
  deep" caps the directory itself once the walk reaches that depth (the
  folder is skipped without being read further), not a per-file depth
  check — a very wide folder exactly at the cap's boundary is still fully
  read; the file-count cap is a single running total shared across every
  top-level folder in one drop, not a separate budget per folder, so
  dropping several large folders together can leave some entirely
  unvisited once the shared cap is reached; the already-existing
  `MAX_DROP_FAILURE_DETAILS` per-file-failure summary cap, and the lack of
  any filename/extension filtering before attempting import, are both
  unchanged from Phase 17; any cloud or multi-device sync; any change to
  the conversation storage/export schema; any new toast/notification UI;
  any provider, payments/subscriptions/billing/accounts/cloud sync/
  marketplace, unrestricted shell/OS automation, installer/release, or
  Founder/Developer-Portal/cross-product-integration work. Nothing from
  Phases 1–17 was refactored or had its behaviour changed beyond the
  additive, backward-compatible changes described above; only
  `src/renderer/ts/dragDropFiles.ts`, `src/renderer/ts/state.ts`,
  `src/renderer/ts/views/history.ts`, `src/renderer/ts/app.ts`,
  `tests/dragDropFiles.test.ts`, `tests/state.test.ts`,
  `tests/historyView.test.ts`, and this README were touched.

## Scope (Phase 19)

This phase was an audit-first reliability/resource-safety pass, not a new
feature. Per the brief, the correct outcome is to fix only what code
inspection actually confirms, add focused regression tests for each fix,
and otherwise leave the architecture, UI, and provider behavior exactly as
Phases 1–18 left them.

- **Audit areas inspected:** the full `README.md` phase history; `git`
  branch/status/diff; the Electron main process (`src/main/main.ts`), the
  preload bridge, both shared IPC contracts
  (`ai-contract.ts`/`conversation-contract.ts`), and the trusted-sender
  check; all four provider adapters (Gemini, OpenAI, Anthropic, Mistral)
  and their shared HTTP/error-mapping helpers; the AI controller's
  single-flight/timeout/cancellation bookkeeping; conversation persistence
  (atomic writes, corrupt-file tolerance), every import/export path
  (single file, bulk file, drag-and-drop text), and Phase 18's
  folder-drop caps; the renderer's streaming request lifecycle
  (`requestLifecycle.ts`, `conversationController.ts`,
  `conversationContext.ts`), History's debounced/stale-safe search, and
  the existing automated test suite (503 tests at the start of this
  phase).
- **Confirmed issue #1 — unbounded in-memory growth of a streaming
  response (`src/renderer/ts/ai/conversationContext.ts`).**
  `appendDelta()` appended every incoming stream chunk to
  `turn.responseText` with no upper bound, even though the exact same
  conversation schema already enforces a hard `MAX_MESSAGE_TEXT_CHARS`
  (60,000-character) ceiling the moment that turn is *saved*
  (`normalizeConversationRecord` in `conversation-contract.ts`). Between
  saves — i.e. for as long as a response is still actively streaming — the
  live in-memory string (and the DOM text rebuilt from it on every single
  delta, since `conversationView.ts` fully re-renders the turn list on
  every `appendDelta`) had no limit at all. A misbehaving provider
  endpoint, a proxy/network bug that never terminates the stream, or any
  other source of a runaway number of deltas could grow memory and
  per-delta render cost without bound for as long as the stream technically
  stayed open, with no cap enforced until the final, already-expensive
  save-time clamp. **Fix:** `appendDelta()` now stops accepting further
  text for a turn once it reaches `MAX_MESSAGE_TEXT_CHARS` (dropping any
  remaining delta text for that turn rather than throwing or aborting the
  stream — consistent with every other bound in this app degrading
  gracefully instead of failing hard), and `completeTurn()` now marks a
  turn `truncated` when AXIS's own cap was the reason a response stopped
  growing, not only when the provider itself reported truncation, so the
  existing "this response may be incomplete" UI note stays honest in both
  cases. This also means the live and persisted representations of a
  turn's response text can never diverge in size anymore.
- **Confirmed issue #2 — no cap on the number of conversations a bulk
  import file may contain (`src/shared/conversation-contract.ts`,
  `src/main/conversations/conversationRepository.ts`).**
  `isValidConversationBulkFile` validated every individual conversation in
  a bulk ("Export all") file's `conversations` array but placed no limit
  on the array's *length*. Both bulk-import entry points —
  `importAllFromFile` (the native "Import all" dialog) and
  `importAnyFromText` (drag-and-drop) — feed straight into this same
  validator, so a hand-edited or corrupted bulk file claiming an
  effectively unbounded number of individually-valid conversations would
  be accepted and then sequentially written to disk one file at a time,
  with no progress reporting and no way to cancel an in-progress import
  once started — unlike every AI request in this app, which is always
  cancellable. **Fix:** added `MAX_BULK_IMPORT_CONVERSATIONS = 2000`
  (generous relative to anything a real "Export all" of a single user's
  own history would ever produce) and enforced it directly inside
  `isValidConversationBulkFile`, so both import entry points are capped by
  the one shared validator they already both relied on — no new,
  duplicated check was added.
- **Confirmed issue #3 — no file-size backstop on the native-dialog
  import paths (`src/main/conversations/conversationRepository.ts`).**
  Phase 13 gave the drag-and-drop import path
  (`isValidImportTextPayload`) an explicit `MAX_DROPPED_IMPORT_TEXT_CHARS`
  (150,000,000-character) ceiling specifically as "a backstop against a
  renderer... handing the main process an unbounded string" — but
  `importConversationFromFile` and `importAllFromFile` (the native
  "Import"/"Import all" open-dialog paths) read the user-selected file
  with no size check at all before loading it entirely into memory as one
  string, an inconsistency with the credential-import flow in
  `credentialStore.ts`, which already does exactly this kind of
  stat-before-read size check for its own file picker. Picking an
  arbitrarily large file via either native dialog had no bound. **Fix:**
  added a small shared `readImportableFileText()` helper that calls
  `fs.stat()` first and rejects (before ever reading the file's bytes)
  any file larger than the same `MAX_DROPPED_IMPORT_TEXT_CHARS` ceiling
  the drop path already uses — reusing the existing constant rather than
  inventing a new one, since both paths exist to protect the same
  schema-shaped data. Both `importConversationFromFile` and
  `importAllFromFile` now go through this one helper instead of each
  calling `fs.readFile` directly. No legitimate AXIS export — including
  the largest single-conversation or bulk export the schema can ever
  produce — comes close to this ceiling, so no real export is affected.
- **Areas inspected and found already sound (no change made):** the
  per-sender single-flight map and `AbortController`/timeout wiring in
  `aiController.ts` (entries are always removed in a `finally` block on
  every code path, including the streaming background task); cancellation
  and abort-listener cleanup in all four provider adapters (each
  consistently registers and removes its own `abort` listener around the
  SSE read loop); conversation storage's atomic "write-temp-then-rename"
  pattern and its tolerance of individually corrupt files; History's
  debounced search with a monotonically-increasing load token that
  already discards a stale, superseded response; the renderer's streaming
  controller's stale-event guard (`event.requestId !== activeRequestId`)
  and its cancel-first isolation when switching or loading a different
  conversation; the credential store's existing file-size cap and
  read-only handling of a user-selected key file; and Phase 18's
  folder-drop recursion/file-count caps, which remain intact and
  unmodified. None of these showed a reproducible failure or a
  demonstrable gap, so none were changed, per the instruction to fix only
  confirmed issues.
- **Files changed:** `src/shared/conversation-contract.ts` (new
  `MAX_BULK_IMPORT_CONVERSATIONS` constant and cap enforced in
  `isValidConversationBulkFile`); `src/main/conversations/conversationRepository.ts`
  (new `readImportableFileText()` helper, used by both
  `importConversationFromFile` and `importAllFromFile`);
  `src/renderer/ts/ai/conversationContext.ts` (bounded `appendDelta`,
  cap-aware `completeTurn`); and this README. Test files:
  `tests/conversation-contract.test.ts`, `tests/main/conversationRepository.test.ts`,
  `tests/conversationContext.test.ts`.
- **Regression tests added:** a bulk-file validation test asserting
  `isValidConversationBulkFile` rejects one conversation over the cap and
  accepts exactly at the boundary; repository-level tests that a bulk
  file over the cap imports nothing (not a partial import) and that
  exactly `MAX_BULK_IMPORT_CONVERSATIONS` conversations are all imported;
  repository-level tests that a file over the size ceiling is rejected
  before being read (for both `importConversationFromFile` and
  `importAllFromFile`) and that a file exactly at the ceiling is still
  read (and only then fails, for being invalid JSON, never for size) —
  using sparse (`ftruncate`-created) fixture files so these tests run
  near-instantly without actually writing ~150 MB to disk; and four
  `conversationContext` tests covering the exact character-count boundary,
  a single delta that straddles the boundary, the `truncated` flag being
  set when AXIS's own cap (not the provider) ended the growth, and that a
  normal short response is never marked truncated.
- **Test, TypeScript, and build results:** `npx vitest run` — **531/531
  tests passing** (521 pre-existing + 10 new; zero regressions).
  `npm run typecheck` (both `tsconfig.main.json` and
  `tsconfig.renderer.json`) — zero errors. `npm run build` (Vite renderer
  bundle + `tsc` main-process build) — succeeds with no errors or new
  warnings.
- **Verification scope:** all of the above was verified only through the
  automated test suite (Vitest, jsdom for renderer tests, a real
  temp-directory-backed repository for main-process tests) and a
  production build check. **No browser preview or native Electron app was
  launched this phase**, and no real provider API call, native file
  dialog, or OS-level file-manager interaction was exercised — those
  remain unverified here, exactly as every prior phase has already
  disclosed for this sandbox.
- **Remaining limitations / flagged but not changed this phase:**
  `conversationView.ts` still fully rebuilds every visible turn's DOM on
  every single streamed delta (not just the turn currently receiving
  text), which is an inherent inefficiency in the current simple
  "re-render the whole list" rendering model, not a new finding — it was
  already implicitly bounded by `MAX_DISPLAY_TURNS` (40 turns) and is now
  additionally bounded per-turn by this phase's `MAX_MESSAGE_TEXT_CHARS`
  streaming cap, so the worst case is now a fixed, finite amount of
  re-render work per delta rather than unbounded. A deeper fix (e.g.
  incrementally patching only the actively-streaming turn's DOM node)
  would be a meaningfully larger, more invasive change to a core rendering
  path than this hardening-focused phase's "bounded, maintainable, preserve
  existing behavior" mandate allows, so it is flagged here for a future
  phase rather than attempted now. `MAX_BULK_IMPORT_CONVERSATIONS` and the
  native-dialog file-size ceiling are both fixed constants, not
  user-configurable (no settings UI was added, consistent with every prior
  phase's "no unrequested UI" constraint). No other confirmed, in-scope
  issue was found this phase.
- **No commit or push was made.** `git status` at the end of this phase
  shows only the same working-tree changes every prior phase has
  accumulated (the repository has had a single "Initial commit" since this
  branch was created); nothing was reset, reverted, or overwritten.

## Scope (Phase 20)

This phase was a targeted rendering-performance pass, triggered by a
concern flagged (but deliberately not fixed) at the end of Phase 19: did
the AI Workspace's conversation view really rebuild its entire visible
transcript's DOM on every single streamed delta? Per the brief, the
correct outcome is to confirm the bottleneck in the current code before
touching anything, add a deterministic (non-timing-based) regression test
that would fail against the old behavior, then make the smallest targeted
change that fixes it while reusing the existing architecture.

- **Confirmed bottleneck (`src/renderer/ts/components/conversationView.ts`).**
  `render(turns)` called `list.replaceChildren(...turns.map(...))`
  unconditionally on every invocation, rebuilding every single turn's
  entire `<li>` subtree — prompt block, response header, state label,
  actions row (including the "Copy" button's internal state), the full
  body re-segmented via `splitIntoSegments`, any note, and any retry
  button — regardless of whether that turn's data had actually changed.
  `conversationController.ts` calls this same `render()` on every
  streamed delta of the one actively-pending turn, so with transcripts
  near the `MAX_DISPLAY_TURNS` (40-turn) cap, a single incoming chunk of
  text for turn 40 tore down and rebuilt turns 1–39's already-settled DOM
  too, for no reason. This matches exactly what Phase 19 flagged and
  deliberately left unfixed as out of scope for a hardening-only pass.
  An incidental correctness side-effect of the same bug: because the
  "Copy" button was destroyed and recreated on every delta, clicking
  "Copy" on a turn that was still actively streaming would have its own
  "Copied" visual feedback reset early by the next delta, and the
  replaced button's pending `setTimeout` would fire against an already
  detached node.
- **Enabling fact used by the fix (`src/renderer/ts/ai/conversationContext.ts`).**
  A `ConversationTurn` is mutated in place by every live-streaming
  transition (`appendDelta`, `completeTurn`, `cancelTurn`, `failTurn`) —
  the same object reference persists for a turn's whole lifetime except
  when a saved conversation is loaded (`replaceTurns`, which produces
  fresh copies) or the conversation is reset. `turn.id` is therefore a
  stable key across renders, and `turn.prompt` is write-once, so a turn's
  prompt block never needs to be touched again once it exists.
- **Fix: keyed DOM reconciliation instead of a full rebuild.**
  `render()` now keeps an internal `Map<string, TurnEntry>` keyed by
  `turn.id`, where each `TurnEntry` holds the turn's `<li>` plus direct
  references to the handful of sub-parts that can actually change (the
  response block, for its status class; the state label; the actions row,
  for adding/removing Retry; the body element; an optional note
  paragraph) and a snapshot of the last-rendered `status`/`responseText`/
  `truncated`/`errorMessage`. On each call: entries whose id has
  disappeared (conversation reset, a different conversation loaded, or
  the oldest turn trimmed by `MAX_DISPLAY_TURNS`) are removed from the
  list and the cache; a turn with no cache entry gets a freshly built
  `<li>` (via a `createEntry()` helper — the same markup the old code
  produced, so every existing CSS selector and test assertion still
  matches); a turn with an existing entry is compared **by field value,
  not by object identity** (required because `replaceTurns` can hand back
  new objects with the same data) and, if nothing tracked actually
  changed, the function returns immediately without touching the DOM at
  all — this is the actual fix: an already-completed turn now does zero
  DOM work while a different turn streams. When something did change,
  only the affected pieces are patched: the response block's class and
  state-label text (only on a status change), the body element is
  rebuilt from the turn's current text via the same unmodified
  `renderResponseBody()`/`splitIntoSegments()` and swapped in with
  `replaceWith` (this is the "only the active message's text actually
  gets re-rendered" part — the per-turn body is still a cheap, bounded
  rebuild, but it no longer drags the rest of the transcript with it),
  the retry button is added or removed based on status, and the note
  paragraph is added, updated, or removed based on the turn's current
  truncation/incomplete state. Positioning uses `insertBefore` only when
  a turn's `<li>` isn't already immediately after the previous turn's
  `<li>`, so the common append-only, no-reorder case never calls it.
  `ConversationViewOptions`/`ConversationViewHandle` are unchanged, so
  `conversationController.ts` and its existing tests needed no changes at
  all. `h()`, `renderResponseBody`, `createCopyButton`, `statusLabel`, and
  `splitIntoSegments` are all reused exactly as they were.
- **CSS compatibility checked before implementing.** Every `.axis-turn*`/
  `.axis-code*` selector in `components.css` was read; none depends on a
  note paragraph or body element being a specific *sibling index* or
  using a combinator that patching-in-place would break (`.axis-turn__response`
  is a plain flex column with a `gap`, and classes are matched directly,
  not positionally), and neither file defines any transition or
  animation on `.axis-turn`/`.axis-code` elements, so persisting DOM
  nodes across renders cannot newly trigger (or newly suppress) a visual
  transition that wasn't already possible. `prefers-reduced-motion`
  handling is a blanket, unrelated rule in `tokens.css`/`layout.css` and
  is untouched.
- **Files changed:** `src/renderer/ts/components/conversationView.ts`
  (rewritten to keyed reconciliation, markup and public interface
  otherwise unchanged); `tests/workspaceConversation.test.ts` (two new
  tests, see below); this README. No other file was touched.
- **Regression tests added (both deterministic, no timing-based
  assertions):** (1) a test that completes a first turn, captures `===`
  references to its `<li>`, prompt-text paragraph, body element, and
  Copy button, then streams several deltas into a **second, later**
  turn, and asserts every one of those first-turn references is still
  the exact same DOM node afterward (and its rendered text is
  unaffected) — this fails against the prior full-rebuild implementation
  and passes against the new one; (2) a test on a single streaming turn
  asserting its `<li>`, state label, and actions-row element stay the
  same reference across consecutive deltas while only the body element
  is actually replaced (confirming text updates land, specifically, on
  the active message's body and nowhere else). Both tests were verified
  to **fail** against a deliberately-reintroduced "always rebuild, never
  reuse" variant of `render()` (confirmed manually in this phase, then
  reverted — not left in the repository) before being confirmed to pass
  against the real fix, so they are known to be meaningful rather than
  vacuous assertions.
- **Test, TypeScript, and build results:** `npx vitest run` — **533/533
  tests passing** (531 pre-existing + 2 new; zero regressions, including
  every existing streaming, cancellation, retry, truncation, XSS-safety,
  code-block/copy, and conversation-switching test). `npm run typecheck`
  (both `tsconfig.main.json` and `tsconfig.renderer.json`) — zero errors.
  `npm run build` (Vite renderer bundle + `tsc` main-process build) —
  succeeds with no errors or new warnings.
- **No performance benchmark was run.** The improvement claimed here is a
  structural, code-level one — the number of DOM nodes created/mutated
  per streamed delta is now bounded by the one turn that actually changed
  instead of every visible turn — not a measured wall-clock number. No
  such measurement was taken this phase, and none should be assumed.
- **Verification scope:** all of the above was verified only through the
  automated test suite (Vitest, jsdom) and a production build check. **No
  browser preview or native Electron app was launched this phase**, and
  no real provider API call was exercised — those remain unverified here,
  exactly as every prior phase has already disclosed for this sandbox.
- **Remaining limitations:** the body element is still rebuilt in full
  (not patched character-by-character or segment-by-segment) whenever a
  turn's response text actually changes; this was a deliberate choice to
  keep the change small and reuse `renderResponseBody`/`splitIntoSegments`
  unmodified rather than attempting a riskier fine-grained text/segment
  diff, and it is bounded per-delta by the same `MAX_MESSAGE_TEXT_CHARS`
  cap Phase 19 added. No other rendering inefficiency was found or
  changed this phase.
- **No commit or push was made.** `git status` at the end of this phase
  shows only the same working-tree changes every prior phase has
  accumulated (the repository has had a single "Initial commit" since
  this branch was created); nothing was reset, reverted, or overwritten.
