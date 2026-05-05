# Bonk Docs Architecture Plan

## Goals

- Rebuild Bonk Docs on `pear-sdk/spaces` and `pear-sdk-yjs`.
- Keep the Electron UI close to the existing app.
- Drop backwards compatibility with the Autobonk implementation.
- Use Bonk Docs as a dogfood/example app for reusable Pear SDK capabilities.

## Key Decisions

- **Data foundation:** each document is a Pear Space (`bonkdocs-doc`).
- **Editor:** TipTap + Yjs, backed by `pear-sdk-yjs`.
- **Presence:** Yjs Awareness replicated through the Pear Space Yjs capability.
- **Identity:** local Pear Space profile identity from `SpaceManager`; no external identity linking.
- **Locks:** first-class optional `pear-sdk/spaces` lock capability, dogfooded here for document locks.
- **Invites:** Pear Space invites and roles (`owner`, `doc-editor`, `doc-viewer`).
- **Desktop first:** this rewrite targets Electron only; native is out of scope for this pass.

## Shared Backend (`packages/bonkdocs-core`)

- `domain/space-definition.js`: Pear Space schema: metadata, Yjs, locks, roles.
- `domain/doc-manager.js`: small wrapper over `SpaceManager`.
- `domain/doc-context.js`: document helpers over one Pear Space.
- `service/doc-worker.js`: HRPC-facing worker used by Electron.
- `build-schema.js`: regenerates Pear Space db/dispatch specs and HRPC types.

## Data Model

- Metadata: `@bonkdocs-doc/metadata`.
- Yjs updates/snapshots/awareness: `@bonk-docs/yjs-*` from `pear-sdk-yjs`.
- Locks: `@bonk-docs/locks` from the SDK lock capability.
- Auth/invites/ACL: built-in Pear Space auth collections.

## Current MVP

- Docs list/create/open/rename.
- Collaborative editing + presence.
- Invite/create/join/revoke.
- Document lock (one permanent UI lock action for now).
