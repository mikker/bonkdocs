# WebRTC Presence Plan

## Objectives

- Replace all Autobonk-based presence syncing with a WebRTC-only flow.
- Keep presence strictly ephemeral: no persistence, no worker-side reconciliation loops.
- Surface consistent user colors for cursors and the title bar badge set.

## Phase 1 – Cleanup & Baseline

- [x] Strip remaining presence helpers from `worker/src/doc-worker.js` and `worker/src/rpc-server.js`.
- [x] Remove unused imports, logging branches, and schema references created for Autobonk presence.
- [x] Verify renderer builds (`npm run build`) and worker smoke tests still pass.

## Phase 2 – Signaling Channel

- [ ] Introduce a lightweight HRPC endpoint (offer/answer exchange) that only brokers WebRTC setup per document session.
- [ ] Generate WebRTC key material with `hypercore-crypto/randomBytes` where entropy is required.
- [ ] Ensure signaling requests contain: document key, participant session id, optional display name seed.
- [ ] Add structured logging around signaling events to ease debugging.

## Phase 3 – Renderer Presence Service

- [ ] Create a renderer-side presence controller that:
  - Opens a WebRTC data channel per active document (lazily, on focus).
  - Broadcasts local presence payloads (color, selection, focus state) on meaningful changes only.
  - Debounces outbound updates and merges inbound peer updates without triggering editor reflows.
- [ ] Persist chosen user color locally (`localStorage`) to keep stable identity across reloads.

## Phase 4 – UI Integration

- [ ] Provide a Zustand slice for presence with a subscription-friendly `usePresence(docId)` selector.
- [ ] Update the editor extension to draw remote cursors/carets with the colors supplied by presence peers.
- [ ] Reintroduce title bar avatars using the same presence store, matching cursor colors.

## Phase 5 – Instrumentation & Guardrails

- [ ] Add verbose logging and a developer toggle to trace WebRTC presence events.
- [ ] Surface connection status in the developer console (connected / reconnecting / failed).
- [ ] Harden against edge cases: dropped peers, stale channels, duplicate session ids.

## Phase 6 – Testing & Verification

- [ ] Write brittle tests that mock the signaling HRPC handler to exercise offer/answer flow.
- [ ] Add renderer unit tests for the presence controller (debounce logic, selection diffs).
- [ ] Manual QA checklist: two clients editing, focus/blur transitions, document creation edge cases.

## Deliverables

- [ ] Worker and renderer code implementing the WebRTC presence pipeline.
- [ ] Updated docs (`docs/architecture-plan.md`, `docs/roadmap.md`) summarising the new presence architecture.
- [ ] Basic troubleshooting guide for presence issues.
