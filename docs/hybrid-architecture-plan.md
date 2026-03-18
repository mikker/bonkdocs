# Bonk Docs Hybrid Architecture Plan

## Goal

Split Bonk Docs into three layers:

- `packages/bonkdocs-core`: shared document domain, worker service, and RPC contract
- `desktop/` host: Electron + Pear Runtime + current web renderer
- `mobile/` host: React Native + Bare worklet + `pear-mobile`

This plan intentionally uses the local reference projects:

- `../hello-pear-electron`
- `../hello-pear-react-native`

Public Pear docs are not the source of truth for this migration.

## Current State

Bonk Docs already has the right conceptual split, but it is spread across top-level folders:

- `core/` contains the Autobonk document domain
- `worker/` contains the local backend and RPC entrypoint
- `renderer/` contains the desktop UI
- `electron/` contains the desktop host shell

The important observation is that the reusable layer is not only `core/`. The reusable layer is:

- document domain: `DocContext`, `DocManager`, schema, roles, invite rules
- worker service: `DocWorker`, watch/apply/pair flows, snapshots, awareness
- RPC contract: generated HRPC spec used by both host UIs

That is the layer both desktop and mobile should build on.

## Local Reference Model

### Desktop reference: `../hello-pear-electron`

From the local Electron example we should keep these patterns:

- the host shell owns `pear-runtime`
- the host starts embedded Bare workers with `pear.run(...)`
- the worker receives storage through `Bare.argv`
- the renderer only talks to the worker over IPC via preload

### Mobile reference: `../hello-pear-react-native`

From the local React Native example we should keep these patterns:

- the React Native view layer starts a bundled Bare worklet with `pear-runtime-react-native`
- the worklet owns `pear-mobile`
- the worklet uses `pear.storage` for Corestore/autobase persistence
- OTA for mobile is managed in the worklet, not in the React Native UI

The mobile worklet is the equivalent of the desktop Bare worker.

## Target Architecture

### 1. `packages/bonkdocs-core`

This package should contain the shared application backend:

- `domain/`
- `service/`
- `schema.js`
- `worker-runtime.js`

Responsibilities:

- Autobonk context management
- invite pairing and ACL enforcement
- Yjs update persistence and replay
- awareness replication
- snapshotting
- HRPC server bootstrap

This package must stay plain JS and Bare-compatible.

### 2. Desktop host

Desktop stays close to the current app:

- `electron/` remains the host shell
- `renderer/` remains the web UI
- the desktop host starts the shared worker runtime from `bonkdocs-core`
- root npm commands for the desktop host are namespaced as `desktop:*`

Desktop-specific responsibilities:

- Electron window lifecycle
- preload bridge
- renderer DOM UI
- TipTap/ProseMirror editor
- desktop OTA wiring

### 3. Mobile host

Mobile should be a new host app modeled after `../hello-pear-react-native`.

Responsibilities:

- Expo/React Native application shell
- startup of the bundled Bare worklet
- mobile OTA wiring
- native or hybrid mobile editor UI
- root npm commands for the mobile host are namespaced as `mobile:*`

The mobile host should not own document sync logic directly. It should only host the shared worker.

## Sync Model

No special desktop-to-mobile bridge is needed.

Each platform instance should run:

1. a local worker/service
2. a local UI talking to that worker
3. peer-to-peer sync through Autobonk/Hyperswarm/Yjs

That means desktop and mobile sync naturally by joining the same document context.

## Identity Decision

This remains the main product question.

Today, each installation has its own writer key and membership state. That means:

- desktop and phone will sync correctly as separate peers
- permissions will still work
- presence will show them as separate participants

If we want “same human, two devices” semantics, we need a later feature for device linking or key transfer. That is not required for the first hybrid version.

## Editor Strategy

The backend is portable. The editor is not.

Current desktop editing is DOM TipTap-based, so it will not drop directly into React Native.

Recommended sequence:

1. keep desktop editor unchanged
2. ship mobile with a simpler initial editor strategy
3. prefer a WebView-hosted editor for the first mobile version if we want shared rich-text behavior quickly
4. only pursue a fully native editor if we accept a larger separate effort

## Migration Plan

### Phase 1. Extract shared backend

- move current domain and worker code into `packages/bonkdocs-core`
- keep compatibility wrappers at old import paths
- keep the generated `spec/` at repo root for now
- make current desktop entrypoints consume the new package boundary

### Phase 2. Introduce host adapters

- define a desktop transport adapter around the current preload bridge
- define a mobile transport adapter around React Native worklet IPC
- move non-UI document session logic behind those adapters

### Phase 3. Scaffold mobile host

- create a React Native host app based on `../hello-pear-react-native`
- bundle a Bare worklet that runs the shared `bonkdocs-core` worker runtime
- use persistent mobile storage provided by `pear-mobile`

### Phase 4. Mobile editing MVP

- start with document list, create/join flows, and watch/sync validation
- add mobile editing after watch/apply flows are stable on device

## Initial Extraction Status

This repo now starts that migration by introducing `packages/bonkdocs-core` as the shared source of truth for:

- domain code
- worker service
- worker runtime bootstrap

The existing `core/` and `worker/` paths remain as compatibility wrappers so the desktop app keeps its current shape while we continue the split.

## Remaining Work

- move shared helper modules and generated specs under `packages/bonkdocs-core`
- extract a transport-agnostic client/session layer from the desktop renderer store
- choose mobile persistence for small UI-only state
- decide first-pass mobile editor approach
