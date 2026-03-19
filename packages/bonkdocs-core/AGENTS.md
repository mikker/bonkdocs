# Core Instructions

These instructions apply to `packages/bonkdocs-core/`.

- This is `core`: the shared backend and document engine used by both `electron` and `native`.
- Keep code plain JavaScript with ESM syntax, 2-space indentation, single quotes, and no semicolons unless required.
- Do not introduce TypeScript here. Prefer JSDoc typedefs if shared types are needed.
- Maintain Bare compatibility. When using modules like `fs`, `path`, or `os`, install the `bare-*` counterpart and update the importmap in `@package.json` as needed.
- Keep worker, schema, and host contracts coherent. Coordinate schema changes with host updates in the same branch when they affect RPC or data shape.
- Add or update `brittle` coverage for OT convergence, worker handlers, invite flows, and presence behavior when core behavior changes.
