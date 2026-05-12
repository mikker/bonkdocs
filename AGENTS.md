# Repository Guidelines

## Nomenclature

- Use `core` for the shared Electron worker backend and document engine.
- Use `electron` for the desktop host in `electron/` plus `renderer/`.
- This rewrite is Electron-only; native/mobile is out of scope for now.

## Common Instructions

- Make the simplest change that keeps the code readable. We do not care about migration.
- `schema.js` delegates to `packages/bonkdocs-core/build-schema.js`, which builds Pear Space db/dispatch specs plus HRPC bundles under `packages/bonkdocs-core/spec/`; update schemas then run `npm run schema:build`.
- All tests use `brittle`. Start files with `import test from 'brittle'`.
- Use `t.plan()` when assertion counts are deterministic and clean up asynchronous resources with `t.teardown()`.
- Run the relevant tests before sharing patches. Use `npm test` when the change is broad enough to justify the full suite.
- Update `docs/architecture-plan.md` and `docs/roadmap.md` whenever architecture or milestone scope changes.
- Record significant flows in dedicated markdown files under `docs/`.
- Always target an explicit Pear storage directory during manual testing to avoid clobbering existing contexts.
- Close Pear Space managers and contexts when scripts finish to release Hyperswarm resources.
- Do not commit invite strings, encryption keys, or generated storage artifacts.

## Scoped Instructions

- `packages/bonkdocs-core/`: see [packages/bonkdocs-core/AGENTS.md](/Users/mikker/dev/holepunch/bonkdocs/packages/bonkdocs-core/AGENTS.md)
- `electron/`: see [electron/AGENTS.md](/Users/mikker/dev/holepunch/bonkdocs/electron/AGENTS.md)
- `renderer/`: see [renderer/AGENTS.md](/Users/mikker/dev/holepunch/bonkdocs/renderer/AGENTS.md)
