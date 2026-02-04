# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run tauri dev      # Run the full Tauri app in dev mode (frontend + Rust backend)
npm run dev            # Start only the Vite dev server on port 5173
npm run build          # Build frontend only (output to dist/)
npm run tauri build    # Build the full Tauri app bundle for distribution
```

Rust backend lives in `src-tauri/` and is built automatically by `tauri dev`/`tauri build`. There are no tests or linting configured.

## Architecture

Tauri 2 desktop app with a Svelte 5 frontend and Monaco Editor. The Rust backend (`src-tauri/src/lib.rs`) is minimal — it only registers Tauri plugins (fs, dialog, log) and runs the app. All application logic lives in the TypeScript/Svelte frontend.

### Key modules

- **`src/App.svelte`** — Root component. Owns all app state (`SessionState`), toolbar, tab bar, keyboard shortcuts, and file operations (open/save/rename/close). State is managed with Svelte 5 runes (`$state`, `$derived`, `$effect`).
- **`src/Editor.svelte`** — Monaco editor wrapper. Creates/disposes the editor instance, handles resize, and syncs theme changes. Recreated on tab switch via `{#key activeTab.id}`.
- **`src/editor.ts`** — Monaco utilities: editor factory, language detection from filename extensions (50+ languages), custom light/dark theme definitions, format command.
- **`src/store.ts`** — Session persistence. Defines `Tab` and `SessionState` types. Saves/loads session index + temp file contents to `{appDataDir}/session.json` and `{appDataDir}/temp/`. Auto-saves every 5 seconds.

### Data flow

User actions in Svelte → Tauri plugin APIs (`@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`) → OS file system. No custom Rust commands; everything goes through Tauri's plugin IPC layer.

### Tab model

Each tab has a `path` (real file on disk, null for unsaved) and a `tempPath` (auto-saved temp file in app data, null for saved files). Dirty state is tracked by comparing `content` vs `savedContent`.

## Tauri Permissions

File system permissions are declared in `src-tauri/capabilities/default.json`. When adding new fs operations, add the corresponding `fs:allow-*` permission there.

## Conventions

- Svelte 5 runes syntax (`$state()`, `$derived()`, `$effect()`) — no legacy `$:` reactive statements
- Svelte 5 event handlers (`onclick`, `onkeydown`) — no legacy `on:click` directive syntax
- No external state management library; all state lives in `App.svelte` as reactive `$state`
- Monaco editor is the only editor — language detection and themes are in `src/editor.ts`
