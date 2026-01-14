# Yjs Awareness Plan

## Objectives

- Use Yjs Awareness for presence (cursors, selection, focus state).
- Keep presence ephemeral by ignoring history and only applying fresh awareness revs.
- Relay awareness updates through the worker and the replicated awareness log.

## Phase 1 – Transport

- [x] Add HRPC endpoints for `applyAwareness` + awareness payloads in `watchDoc`.
- [x] Ensure awareness updates are throttled on the renderer side.

## Phase 2 – Renderer Integration

- [x] Wire TipTap CollaborationCursor to the shared Awareness instance.
- [ ] Persist local user color + name (optional) for stable identity.

## Phase 3 – UI Integration

- [ ] Display active peers in the title bar (avatars or initials).
- [ ] Provide a `usePresence(docId)` selector in Zustand for UI consumption.

## Phase 4 – Instrumentation & Testing

- [ ] Add verbose logging for awareness updates in a debug mode.
- [ ] Add brittle tests that validate awareness fan-out through the worker.

## Deliverables

- [x] Worker and renderer code implementing the Yjs Awareness pipeline.
- [ ] Updated docs (`docs/architecture-plan.md`, `docs/roadmap.md`) summarising the new presence architecture.
