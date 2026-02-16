# skriv

A lightweight desktop text and code editor.

## Features

- Multi-tab editing with session persistence
- Syntax highlighting for 50+ languages via Monaco Editor
- Light and dark themes
- Auto-save with session restore
- Auto-updates

## Download

Grab the latest release from [GitHub Releases](https://github.com/Feryla/skriv/releases).

## Development

Prerequisites: Node 20+, Rust

```bash
npm ci
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

## Releasing

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
2. Commit, tag (`git tag vX.Y.Z`), and push with tags
3. GitHub Actions builds and publishes releases for all platforms

## Tech Stack

Tauri 2, Svelte 5, Monaco Editor, TypeScript
