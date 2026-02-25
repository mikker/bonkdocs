# Repository Guidelines

## Project Structure & Module Organization

- `schema.js` builds Autobonk-compatible bundles under `spec/`; update schemas then run `npm run schema:build`.
- `core/` holds Bare-ready plain JS modules (e.g. `doc-context.js`, `doc-manager.js`, `ot/`).
- `worker/` exposes the Pear Runtime worker entry (`doc-worker.js`, watchers, HRPC handlers). Keep it ESM, plain JS, Bare-compatible.
- `renderer/` is the only TypeScript zone; Vite handles builds and hot reload. UI state lives in Zustand stores, while TipTap powers the editor.
- `docs/` captures architecture plans, roadmap, and additional design notes; keep it current with code changes.

## Build, Test & Development Commands

- `npm install` once to fetch deps.
- `npm run dev` starts Vite and Electron with Pear Runtime worker boot. Use it for interactive renderer work.
- `npm run schema:build` regenerates `spec/` artifacts after schema updates.
- `npm test` runs the `brittle` suites. Write new tests under `test/` with `.test.js`.
- Prefer `npm run build` for production renderer bundles before packaging with Electron Forge.

## Coding Style & Tooling

- Plain JS files use ESM syntax, 2-space indentation, single quotes, no semicolons unless required.
- Renderer TypeScript follows existing Vite config; keep utility modules typed to aid TipTap integration.
- Maintain Bare compliance: when using `fs`, `path`, `os`, etc.— install their `bare-*` counterparts and add a field to the importmap in @package.json.
- Document non-obvious logic with concise comments; prefer design notes in `docs/`.

## Testing Guidelines

- All tests use `brittle`. Start files with `import test from 'brittle'`.
- Use `t.plan()` when assertion counts are deterministic and clean up asynchronous resources with `t.teardown()`.
- Cover OT convergence, worker HRPC handlers, and presence timing. Mirror patterns from `pear-jam` for watcher tests.
- Run `npm test` before sharing patches; ensure Phase-specific features have matching suites as they land.

## Documentation Maintenance

- Update `docs/architecture-plan.md` and `docs/roadmap.md` whenever architecture or milestone scope changes.
- Record significant flows (OT data model, presence protocol, invite UX) in dedicated markdown files under `docs/`.
- Keep inline README instructions brief; move deep dives to the docs directory.

## Agent-Specific Instructions

- Always target an explicit Pear storage directory during manual testing to avoid clobbering existing contexts.
- Close Autobonk managers/contexts when scripts finish to release Hyperswarm resources.
- Do not commit invite strings, encryption keys, or generated storage artifacts.
- Respect the no-TypeScript rule outside `renderer/`. For shared utilities, prefer JSDoc typedefs over `.ts`.
- Coordinate schema changes with worker/renderer updates in the same branch to keep HRPC contracts aligned.

### React useEffect Guidelines

**Before using useEffect, read: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)**

Common cases where useEffect is NOT needed:

- Transforming data for rendering (use variables or useMemo instead)
- Handling user events (use event handlers instead)
- Resetting state when props change (use key prop or calculate during render)
- Updating state based on props/state changes (calculate during render)

Only use 'useEffect' for:

- Synchronizing with external systems (APIs, DOM, third-party libraries)
- Cleanup that must happen when component unmounts
