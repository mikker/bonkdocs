# Electron Instructions

These instructions apply to `electron/`.

- This is the `electron` surface: the desktop shell and preload bridge.
- `electron` does not mean `native`. A narrow desktop window is still `electron`.
- Keep Electron main and preload code plain JavaScript with ESM syntax.
- Preserve the bridge contract between `electron`, `renderer`, and `core`. Changes to preload APIs should be coordinated with renderer callers in the same branch.
- For interactive desktop renderer work, use `npm run desktop:dev`.
- Expect `electron/main.js` and `electron/preload.js` changes to need an Electron restart even when renderer HMR is active.
