# Bonk Docs Roadmap

## Phase 0 — Autobonk Foundations

- Overhaul `schema.js` with doc namespaces and regenerate specs.
- Implement `core/doc-context.js` and `core/doc-manager.js` in plain JS using Bare shims.
- Scaffold HRPC handlers for create/join/list/remove/watch before Yjs wiring.
- Build minimal renderer flow: docs list, create/join dialogs, static TipTap mount fed by snapshot.
- Validate invite pairing and local metadata persistence end-to-end.

## Phase 1 — Collaborative Editing Core

- Adopt Yjs CRDT core with TipTap Collaboration + CollaborationCursor.
- Add `worker/doc-worker.js` apply/watch handlers that commit Yjs updates and stream diffs.
- Stream state-vector sync + update tail via watcher; hydrate renderer store with Y.Doc.
- Implement Yjs Awareness presence (peer cursors optional).
- Harden offline update replay and snapshot compaction; add brittle coverage for Yjs convergence.

## Phase 2 — Collaboration Polish

- Activate comment storage (`@bonk-docs/comments`) and renderer drawer UI.
- Enhance presence UI (avatars, named cursors, doc activity sidebar).
- Add document history view powered by Autobonk log replay.
- Expand invites management (role changes, revocation, resend) in worker + renderer.
- Increase test depth: watcher streaming scenarios, invite ACL enforcement, presence expiry.

## Phase 3 — Asset & Extensibility Prep

- Finalize schema + storage plan for embedded assets (`@bonk-docs/assets`, Hyperblobs pointers).
- Prototype image/table insertion flows without shipping them in earlier phases.
- Integrate asset permissions and upload/download HRPC routes.
- Document extension hooks for future features (templates, export).
- Conduct broader reliability testing (offline → online transitions, large doc playback).

## Phase 4 — Hybrid Hosts

- Extract the shared backend into `packages/bonkdocs-core`.
- Keep the current Electron app as the first `desktop` host over that package.
- Scaffold a React Native `mobile` host using the local `hello-pear-react-native` layout.
- Reuse the same worker/runtime and HRPC contract across desktop and mobile.
- Decide first-pass mobile editor strategy after watch/sync flows are stable.
