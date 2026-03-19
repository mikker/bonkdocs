# Repository Guidelines

## Nomenclature

- Use `core` for the shared backend and document engine.
- Use `electron` for the desktop host in `electron/` plus `renderer/`.
- Use `native` for the React Native host in `mobile/`.
- Use `mobile editor bundle` for the embedded web editor in `renderer/src/mobile-editor/` generated into `mobile/src/generated/editor-web-bundle.ts`.
- Do not use `native` to mean "small screen".
- A narrow Electron window is still `electron`, not `native`.

## Common Instructions

- Make the simplest change that keeps the code readable. We do not care about migration.
- `schema.js` builds Autobonk-compatible bundles under `spec/`; update schemas then run `npm run schema:build`.
- All tests use `brittle`. Start files with `import test from 'brittle'`.
- Use `t.plan()` when assertion counts are deterministic and clean up asynchronous resources with `t.teardown()`.
- Run the relevant tests before sharing patches. Use `npm test` when the change is broad enough to justify the full suite.
- Update `docs/architecture-plan.md` and `docs/roadmap.md` whenever architecture or milestone scope changes.
- Record significant flows in dedicated markdown files under `docs/`.
- Always target an explicit Pear storage directory during manual testing to avoid clobbering existing contexts.
- Close Autobonk managers and contexts when scripts finish to release Hyperswarm resources.
- Do not commit invite strings, encryption keys, or generated storage artifacts.

## Scoped Instructions

- `packages/bonkdocs-core/`: see [packages/bonkdocs-core/AGENTS.md](/Users/mikker/dev/holepunch/bonkdocs/packages/bonkdocs-core/AGENTS.md)
- `electron/`: see [electron/AGENTS.md](/Users/mikker/dev/holepunch/bonkdocs/electron/AGENTS.md)
- `renderer/`: see [renderer/AGENTS.md](/Users/mikker/dev/holepunch/bonkdocs/renderer/AGENTS.md)
- `mobile/`: see [mobile/AGENTS.md](/Users/mikker/dev/holepunch/bonkdocs/mobile/AGENTS.md)
