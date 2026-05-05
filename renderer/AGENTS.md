# Renderer Instructions

These instructions apply to `renderer/`.

- This directory is part of the `electron` surface.
- `renderer/` is the only TypeScript zone in the repo. Keep utility modules typed where that helps integration.
- Use `npm run desktop:dev` for the fastest desktop UI loop.

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
