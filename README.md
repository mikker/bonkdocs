# Bonk Docs (EXPERIMENTAL 🚧)

Peer-to-peer collaborative docs built on Pear Spaces, pear-sdk-yjs, Yjs, and Pear runtimes.

This rewrite keeps the Electron UI and replaces the document internals with `pear-sdk/spaces` from the sibling checkout at `../pear-sdk`.

## Setup

```bash
npm install
```

## Development

```bash
npm run desktop:dev
```

For isolated manual testing, prefer an explicit Pear storage directory:

```bash
npm run desktop:start -- --storage /tmp/bonkdocs-test
```

## Build And Package

```bash
npm run desktop:build
npm run desktop:package
npm run desktop:make
```

## Tests And Tooling

```bash
npm test
npm run schema:build
npm run lint
npm run format
```

`schema:build` regenerates Pear Space db/dispatch specs plus the HRPC worker contract under `packages/bonkdocs-core/spec/`.

## Repository Layout

- `packages/bonkdocs-core/`: shared Electron worker backend and Pear Space definition
- `electron/`: desktop shell
- `renderer/`: desktop renderer UI
- `worker/`: compatibility wrapper around the shared worker runtime
- `docs/`: architecture and roadmap notes

## License

MIT
