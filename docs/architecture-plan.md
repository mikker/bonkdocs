# Pear Docs Architecture Plan

## Goals

- Deliver a peer-to-peer Google Docs–style editor on Pear using Autobonk contexts.
- Keep all non-renderer code plain JavaScript running on Bare runtime shims.
- Power collaborative editing with Operational Transformation while preserving offline resilience.
- Reuse Autobonk invite flows so document access stays consistent across Pear apps.

## Key Decisions

- **Editor Surface:** TipTap (ProseMirror-based) in the renderer for rich-text primitives and collaboration hooks.
- **Roles:** Doc-wide `owner`, `editor`, `commenter`, `viewer` seeded during context initialization.
- **Runtime:** Bare-compatible modules only (`bare-path`, `bare-fs`, etc.) outside the Vite renderer.
- **Testing:** Use `brittle` for unit/integration coverage mirroring other Pear projects.

## System Overview

### Autobonk Domain (core/)

- `doc-context.js`: Extends `Context`, wires schema routes, seeds roles, manages snapshots.
- `doc-manager.js`: Wraps Autobonk `Manager`, handles invite lifecycle, local metadata.
- `ot/` modules: Shared OT operation model plus transform/apply logic reused by worker and renderer.
- `presence/` helpers: Heartbeat and stale detection utilities for cursors and status indicators.

### Worker Layer (worker/)

- `doc-worker.js`: HRPC handlers (`initialize`, `listDocs`, `createDoc`, `joinDoc`, `watchDoc`, `applyOp`, `updatePresence`, `issueInvite`, `revokeInvite`, `addComment` later).
- `watchers/doc-watcher.js`: Emits consolidated doc snapshots (revision, optional snapshot blob, queued ops tail, presence, invites, permissions).
- Local caches persist active doc metadata and pending ops to tolerate offline sessions.

### Renderer Layer (renderer/)

- `state/doc-store.ts`: Zustand slices for docs list, active snapshot, pending ops, presence, comments, UI state (persisted via IndexedDB middleware).
- `lib/editor-adapter.ts`: Bridges TipTap collaboration extension with OT queue, performs optimistic apply and reconciles server acknowledgements.
- UI reflects Pear Jam layout patterns: doc list panel, share modal, TipTap editor surface, presence bar, comment drawer (Phase 2).

## Data & Sync Model

- Autobonk schema namespaces: `@pear-docs/oplog`, `@pear-docs/snapshots`, `@pear-docs/presence`, `@pear-docs/comments`, `@pear-docs/metadata`, `@pear-docs/assets` (reserved for Phase 3).
- Worker applies OT ops deterministically using shared transformers; rejects or re-orders conflicting ops before committing to the Autobase log.
- Periodic snapshots captured after N ops or idle windows accelerate late joins; renderer loads snapshot, replays tail ops, and merges local pending edits.
- Presence heartbeats stored in Autobonk view allow watchers to broadcast live cursors; renderer degrades gracefully when peers fall offline.

## Offline & Recovery

- Pending ops queue persisted locally so edits made while disconnected replay once Autobonk regains writability.
- Snapshot fallbacks ensure the editor can recover after crashes by rehydrating the last known document body plus tail ops.
- Local metadata Hyperbee tables track joined docs, last-read rev, and invite cache for quick bootstrap.

## Testing & Tooling

- `brittle` suites cover OT transform correctness (`core/ot/tests`), worker HRPC flows (`test/worker`), and presence timing edges.
- Schema updates go through `npm run schema:build` (already wired) to regenerate dispatch/db/hrpc bundles.
- Linting/formatting remains whatever the repo currently enforces; avoid introducing TypeScript outside `renderer/`.
