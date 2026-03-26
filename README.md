# Bonk Docs (EXPERIMENTAL 🚧)

Peer-to-peer collaborative docs built on Autobonk, Yjs, and Pear runtimes.

This repo contains the shared `core` document engine, the `electron` desktop host, and a first-pass `native` React Native host that reuses the same worker and RPC surface.

## Current Status

- `electron` is the main host today. It includes doc list, create/join flows, collaborative editing, presence, invites, rename, lock, and abandon flows.
- `native` exists and is wired to the shared backend, but it is still earlier than desktop. It uses a WebView-backed `mobile editor bundle` plus native document chrome.
- `core` lives in `packages/bonkdocs-core/` and owns the shared doc context, manager, worker service, schema, and runtime wiring.

## Prerequisites

- Node.js and npm
- A sibling checkout of `autobonk-yjs` at `../autobonk-yjs` because the root package depends on `file:../autobonk-yjs`
- For `native` iOS work: Xcode, CocoaPods, and the usual Expo native toolchain

## Setup

```bash
npm install
```

If you are working on `native`, install its dependencies too:

```bash
npm run mobile:install
```

## Development

### Electron

```bash
npm run desktop:dev
```

This starts Vite on `http://localhost:5173` and launches Electron with updates disabled.

For isolated manual testing, prefer an explicit Pear storage directory:

```bash
npm run desktop:start -- --storage /tmp/bonkdocs-test
```

### Native

The `native` host uses two generated artifacts:

- the `mobile editor bundle` generated from `renderer/src/mobile-editor/`
- the bundled Bare worker generated inside `mobile/src/`

Common commands:

```bash
npm run mobile:bundle:web-editor
npm run mobile:bundle:bare
npm run mobile:ios
```

- `mobile:bundle:web-editor` rebuilds the embedded editor into `mobile/src/generated/editor-web-bundle.ts`
- `mobile:bundle:bare` rebuilds the editor bundle and the native Bare worker
- `mobile:ios` rebuilds the editor bundle and launches the iOS app from `mobile/`

## Build And Package

```bash
npm run desktop:build
npm run desktop:package
npm run desktop:make
```

- `desktop:build` builds the desktop renderer
- `desktop:package` creates a local Electron package
- `desktop:make` builds platform installers through Electron Forge

## Tests And Tooling

```bash
npm test
npm run schema:build
npm run lint
npm run format
```

- `npm test` runs the root `brittle` suite
- `schema:build` regenerates Autobonk-compatible bundles under `spec/`
- `sim:typing` runs the local typing simulation used for collaboration testing

## Repository Layout

- `packages/bonkdocs-core/`: shared backend and document engine
- `electron/`: desktop shell
- `renderer/`: desktop renderer UI plus `mobile editor bundle` source
- `mobile/`: React Native host
- `worker/`: compatibility wrapper around the shared worker during the migration to `core`
- `docs/`: architecture, roadmap, and nomenclature notes

## Notes

- Use `core`, `electron`, `native`, and `mobile editor bundle` consistently when talking about the codebase.
- When changing schema or RPC types, run `npm run schema:build`.
- During manual testing, use explicit storage paths so you do not reuse old local contexts by accident.

## License

MIT
