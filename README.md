# AXIS

**One AI. Every tool.**

AXIS is a desktop AI control platform designed to plan and coordinate work across professional applications. This repository currently contains **Phase 1: Desktop Foundation + Premium Product UI**.

## Phase 1

Implemented in this phase:

- Tauri 2 desktop shell with a minimal Rust entry point
- React, TypeScript, and Vite frontend
- Home, AI, Apps, Projects, Workflows, Activity, Points, and Settings views
- Persistent dark, light, and system appearance preferences
- Reusable product UI and centralized design tokens
- Accessible keyboard/focus states and responsive desktop-window layouts
- Honest foundation states for functionality that is not active yet

AI requests, provider credentials, application connectors, task execution, project persistence, workflows, billing, and points accounting are **not implemented in Phase 1**. Their screens are foundations for later phases and do not simulate those capabilities.

## Technology

- [Tauri 2](https://tauri.app/) and Rust
- React 19 and TypeScript
- Vite
- React Router
- Lucide icons
- CSS design-token system
- Vitest and Testing Library

## Local development

### Prerequisites

- Node.js 20 or newer
- Rust 1.88 or newer
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

```bash
npm install
npm run tauri:dev
```

For frontend-only UI development:

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
```

Run every frontend check with:

```bash
npm run check
```

## Production desktop build

```bash
npm run tauri:build
```

Tauri writes native build output under `src-tauri/target/`. Packaging requirements vary by operating system.

## Configuration

Copy `.env.example` only when public build-time metadata needs to be overridden. Never place API keys or credentials in `VITE_` variables; Vite exposes them to the frontend bundle. Secure native credential handling will be introduced with real provider support in a later phase.
