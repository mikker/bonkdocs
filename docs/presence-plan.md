# Yjs Awareness Plan

## Objectives

- Use Yjs Awareness for presence (cursors, selection, focus state).
- Keep presence ephemeral: no persistence, no recovery replays.
- Relay awareness updates through the worker for consistent multi-peer delivery.

## Phase 1 – Transport

- [x] Add HRPC endpoints for `applyAwareness` + awareness payloads in `watchDoc`.
- [ ] Ensure awareness updates are throttled on the renderer side.

## Phase 2 – Renderer Integration

- [ ] Wire TipTap CollaborationCursor to the shared Awareness instance.
- [ ] Persist local user color + name (optional) for stable identity.

## Phase 3 – UI Integration

- [ ] Display active peers in the title bar (avatars or initials).
- [ ] Provide a `usePresence(docId)` selector in Zustand for UI consumption.

## Phase 4 – Instrumentation & Testing

- [ ] Add verbose logging for awareness updates in a debug mode.
- [ ] Add brittle tests that validate awareness fan-out through the worker.

## Deliverables

- [ ] Worker and renderer code implementing the Yjs Awareness pipeline.
- [ ] Updated docs (`docs/architecture-plan.md`, `docs/roadmap.md`) summarising the new presence architecture.
