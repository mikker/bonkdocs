# Bonk Docs

Peer-to-peer collaborative docs on Autobonk with a React renderer, Electron shell, and Pear Runtime workers.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Runs Vite on `http://localhost:5173` and starts Electron with `pear-runtime`.
Like `hello-pear-electron`, development runs with OTA updates disabled and uses temporary Pear storage unless you pass an explicit `--storage` path.

For isolated manual testing, prefer an explicit storage directory:

```bash
npm run start -- --storage /tmp/bonk-docs-test
```

## Build

```bash
npm run build
```

Builds the renderer into `renderer/dist`.

## Package (local)

```bash
npm run package
```

Creates a local packaged Electron app with Electron Forge.

## Test

```bash
npm test
```

## License

MIT
