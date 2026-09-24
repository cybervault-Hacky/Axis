# AXIS

**One AI. Every tool.**

AXIS is a desktop control surface designed to coordinate AI-assisted work across professional applications. The repository currently contains **Phase 2: Navigation, App Shell & Core Interaction Foundation**.

> AXIS does not execute tasks or connect to AI providers and external apps in this phase. Every future capability is presented as planned or unavailable; the interface does not fabricate responses, connection states, activity, balances, or execution records.

## Phase 2 foundation

- Tauri 2 desktop shell with an undecorated window, custom title bar, drag region, and native window controls
- React 19, strict TypeScript, Vite, and hash-based desktop routing
- Responsive app shell with persisted expanded/compact navigation and accessible icon tooltips
- Home, AI, Apps, Projects, Workflows, Activity, Points, Settings, and deliberate unknown-route views
- Session-only command composer with clear, Enter, Escape, and truthful unavailable feedback
- Global `Ctrl+K` / `Command+K` palette with search, arrow-key selection, local navigation, and focus restoration
- Persistent dark, light, and system appearance preferences with separately tuned themes
- Accessible native dialogs, notification toasts, loading/error/empty-state primitives, and reduced-motion behavior
- Separated providers for appearance, safe UI preferences, command UI, notifications, and local system status
- Shared design tokens, Lucide SVG icons, and reusable integration/search/card foundations
- Focused route, command, persistence, dialog, and notification tests

Only safe visual preferences are stored locally (`axis:theme` and `axis:sidebar`). Command drafts are kept in memory for the current session and are never submitted or persisted.

## Technology

- [Tauri 2](https://tauri.app/) and Rust
- React 19 and TypeScript
- Vite and React Router
- Lucide icons
- CSS design-token system
- Vitest and Testing Library

## Local development

### Prerequisites

- Node.js 20 or newer
- Rust 1.88 or newer
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

Install the locked frontend dependencies and start the desktop app:

```bash
npm ci
npm run tauri:dev
```

For frontend-only interface development:

```bash
npm run dev
```

Vite serves the interface at `http://localhost:1420`.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=low
```

Run the four frontend quality checks together with:

```bash
npm run check
```

Validate the native project when platform prerequisites are installed:

```bash
npm run tauri:info
npm run tauri:build -- --debug
```

## Production desktop build

```bash
npm run tauri:build
```

Tauri writes native build output under `src-tauri/target/`. Native compilation and packaging require the operating system libraries documented by Tauri; on Linux this includes the appropriate WebKitGTK development packages.

## Configuration and security

Copy `.env.example` only when public build-time metadata needs to be overridden. Never place API keys or credentials in `VITE_` variables because Vite exposes them to the frontend bundle. Secure native credential handling will be introduced only alongside real provider support in a later phase.
