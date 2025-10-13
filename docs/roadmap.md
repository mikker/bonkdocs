# Pear Docs Roadmap

## Phase 0 — Autobonk Foundations
- Overhaul `schema.js` with doc namespaces and regenerate specs.
- Implement `core/doc-context.js` and `core/doc-manager.js` in plain JS using Bare shims.
- Scaffold HRPC handlers for create/join/list/remove/watch without OT.
- Build minimal renderer flow: docs list, create/join dialogs, static TipTap mount fed by snapshot.
- Validate invite pairing and local metadata persistence end-to-end.

## Phase 1 — Collaborative Editing Core
- Land shared OT engine in `core/ot/` plus TipTap adapter in `renderer/lib/editor-adapter.ts`.
- Add `worker/doc-worker.js` apply/watch handlers that transform, commit, and acknowledge ops.
- Stream snapshots + ops tail via watcher; hydrate renderer Zustand store with optimistic reconciliation.
- Implement presence heartbeats and basic UI indicators (peer cursors optional).
- Harden offline queue replay and conflict handling; add brittle coverage for OT convergence.

## Phase 2 — Collaboration Polish
- Activate comment storage (`@pear-docs/comments`) and renderer drawer UI.
- Enhance presence UI (avatars, named cursors, doc activity sidebar).
- Add document history view powered by Autobonk log replay.
- Expand invites management (role changes, revocation, resend) in worker + renderer.
- Increase test depth: watcher streaming scenarios, invite ACL enforcement, presence expiry.

## Phase 3 — Asset & Extensibility Prep
- Finalize schema + storage plan for embedded assets (`@pear-docs/assets`, Hyperblobs pointers).
- Prototype image/table insertion flows without shipping them in earlier phases.
- Integrate asset permissions and upload/download HRPC routes.
- Document extension hooks for future features (templates, export).
- Conduct broader reliability testing (offline → online transitions, large doc playback).

