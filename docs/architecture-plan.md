# Pear Docs Architecture Plan

## Goals

- Deliver a peer-to-peer Google Docs–style editor on Pear using Autobonk contexts.
- Keep all non-renderer code plain JavaScript running on Bare runtime shims.
- Power collaborative editing with Yjs CRDT updates while preserving offline resilience.
- Reuse Autobonk invite flows so document access stays consistent across Pear apps.

## Key Decisions

- **Editor Surface:** TipTap (ProseMirror-based) in the renderer with Yjs collaboration.
- **Presence:** Yjs Awareness, relayed through the worker and replicated via an awareness log.
- **Roles:** Doc-wide `owner`, `editor`, `commenter`, `viewer` seeded during context initialization.
- **Runtime:** Bare-compatible modules only (`bare-path`, `bare-fs`, etc.) outside the Vite renderer.
- **Testing:** Use `brittle` for unit/integration coverage mirroring other Pear projects.

## System Overview

### Autobonk Domain (core/)

- `doc-context.js`: Extends `Context`, wires schema routes, seeds roles, manages snapshots.
- `doc-manager.js`: Wraps Autobonk `Manager`, handles invite lifecycle, local metadata.
- Yjs update log stored in `@bonk-docs/updates`, plus periodic snapshots under `@bonk-docs/snapshots`.

### Worker Layer (worker/)

- `doc-worker.js`: HRPC handlers (`initialize`, `listDocs`, `createDoc`, `joinDoc`, `watchDoc`, `applyUpdates`, `applyAwareness`, `issueInvite`, `revokeInvite`, `addComment` later).
- Streams Yjs updates to renderers via `watchDoc`; applies incoming updates to Autobase log.
- Maintains an in-memory Y.Doc per active context plus periodic snapshots for fast rehydration.

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
- Linting/formatting remains whatever the repo currently enforces; avoid introducing TypeScript outside `renderer/`.
