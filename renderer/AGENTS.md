# Renderer Instructions

These instructions apply to `renderer/`.

- This directory is part of the `electron` surface unless you are working in `renderer/src/mobile-editor/`, which belongs to the `mobile editor bundle` for `native`.
- `renderer/` is the only TypeScript zone in the repo. Keep utility modules typed where that helps integration.
- Use `npm run desktop:dev` for the fastest desktop UI loop.
- If you change `renderer/src/mobile-editor/`, remember that it feeds `native`, not `electron`. Rebuild it with `npm run mobile:bundle:web-editor`.

## React useEffect Guidelines

**Before using useEffect, read: [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)**

Common cases where useEffect is NOT needed:

- Transforming data for rendering (use variables or useMemo instead)
- Handling user events (use event handlers instead)
- Resetting state when props change (use key prop or calculate during render)
- Updating state based on props/state changes (calculate during render)

Only use `useEffect` for:

- Synchronizing with external systems (APIs, DOM, third-party libraries)
- Cleanup that must happen when component unmounts
