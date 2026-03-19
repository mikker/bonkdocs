# Bonk Docs Architecture Plan

## Goals

- Deliver a peer-to-peer Google Docs-style editor on Autobonk contexts.
- Keep all non-renderer code plain JavaScript running on Bare runtime shims.
- Power collaborative editing with Yjs CRDT updates while preserving offline resilience.
- Reuse Autobonk invite flows so document access stays consistent across apps.
- Extract the shared backend so desktop and mobile hosts can run the same sync engine.

## Key Decisions

- **Editor Surface:** TipTap (ProseMirror-based) in the renderer with Yjs collaboration.
- **Presence:** Yjs Awareness, relayed through the worker and replicated via an awareness log.
- **Roles:** Doc-wide `owner`, `editor`, `commenter`, `viewer` seeded during context initialization.
- **Desktop Runtime:** Electron shell with `pear-runtime` for Bare worker execution.
- **Runtime Modules:** Bare-compatible modules only (`bare-path`, `bare-fs`, etc.) outside the Vite renderer.
- **Testing:** Use `brittle` for unit/integration coverage mirroring other Pear projects.

## Naming Conventions

- Use `core` for the shared backend under `packages/bonkdocs-core`.
- Use `electron` for the desktop host in `electron/` plus `renderer/`.
- Use `native` for the React Native host in `mobile/`.
- Use `mobile editor bundle` for the embedded web editor under `renderer/src/mobile-editor/` that is generated into `mobile/src/generated/editor-web-bundle.ts`.
- Do not use `mobile` to mean "small Electron window" when discussing bugs or feature work.

See [nomenclature.md](./nomenclature.md) for the canonical wording.

## System Overview

### Shared Backend (`packages/bonkdocs-core`)

- `domain/doc-context.js`: Extends `Context`, wires schema routes, seeds roles, manages snapshots.
- `domain/doc-manager.js`: Wraps Autobonk `Manager`, handles invite lifecycle, local metadata.
- Yjs update log stored in `@bonk-docs/updates`, plus periodic snapshots under `@bonk-docs/snapshots`.
- `service/doc-worker.js`: Local backend used by every host UI.
- `worker-runtime.js`: Boots HRPC against the shared worker in a Bare runtime.

### Desktop Shell (electron/)

- `main.js`: Boots Electron, starts `pear-runtime`, and wires worker IPC to renderer preload bridge.
- `preload.js`: Exposes `window.bridge` APIs used by renderer RPC transport.

### Mobile Shell (native/)

- React Native host starts a bundled Bare worklet using the same shared worker runtime.
- The worklet owns `pear-mobile`, storage, and mobile OTA behavior.
- Root navigation uses React Navigation drawer + native stack so the docs list lives in the drawer and document chrome stays in the native header.
- The editor itself stays inside the mobile editor bundle WebView, with native controls limited to document-level actions.

### Worker Layer (worker/)

- `worker/` now serves as a compatibility wrapper around `packages/bonkdocs-core` while the desktop host is migrated.

### Renderer Layer (renderer/)

- `state/doc-store.ts`: Zustand slices for docs list, active Y.Doc + Awareness, invites, UI state.
- TipTap Collaboration + CollaborationCursor extensions bind directly to the Y.Doc.
- UI reflects Pear Jam layout patterns: doc list panel, share modal, TipTap editor surface, presence bar, comment drawer (Phase 2).

## Data & Sync Model

- Autobonk schema namespaces: `@bonk-docs/updates`, `@bonk-docs/snapshots`, `@bonk-docs/metadata`, `@bonk-docs/comments`, `@bonk-docs/assets` (reserved for Phase 3).
- Worker appends raw Yjs updates to the Autobase log; updates are commutative and idempotent, so ordering is safe.
- Periodic snapshots capture `Y.encodeStateAsUpdate` plus state vectors to accelerate late joins and restarts.
- Presence uses Yjs Awareness updates replicated through `@bonk-docs/awareness`; clients ignore history and only apply new revs.

## Offline & Recovery

- Renderer can continue editing while offline; Yjs updates are queued and replayed on reconnect.
- Snapshot fallbacks ensure the editor can recover after crashes by rehydrating the last known Y.Doc state.
- Local metadata Hyperbee tables track joined docs, last-read rev, and invite cache for quick bootstrap.

## Testing & Tooling

- `brittle` suites cover Yjs update flows, worker HRPC handlers (`test/worker`), and presence timing edges.
- Schema updates go through `npm run schema:build` (already wired) to regenerate dispatch/db/hrpc bundles.
- Desktop manual development now runs through `npm run desktop:dev`.
- Linting/formatting remains whatever the repo currently enforces; avoid introducing TypeScript outside `renderer/`.
