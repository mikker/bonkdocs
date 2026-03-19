# Bonk Docs Nomenclature

Use these names consistently in issues, commits, prompts, and docs.

## Canonical Terms

- `core`: The shared backend and document engine.
  - Main code: `packages/bonkdocs-core/`
  - Includes doc context, manager, worker service, and shared runtime logic.
- `electron`: The desktop host app.
  - Main code: `electron/` and `renderer/`
  - Includes the Electron shell, preload bridge, and desktop renderer UI.
- `native`: The React Native host app.
  - Main code: `mobile/`
  - Includes the iOS/Android host, native navigation, and native runtime wiring.

## Important Distinctions

- `native` does not mean "small screen" or "mobile-sized layout".
- A narrow Electron window is still `electron`, not `native`.
- `mobile editor bundle` means the embedded web editor shipped into the native app.
  - Source: `renderer/src/mobile-editor/`
  - Generated output consumed by native: `mobile/src/generated/editor-web-bundle.ts`

## Preferred Language

- Say `core bug` when the problem is in shared sync, worker, schema, or document logic.
- Say `electron bug` when the problem is in the desktop shell or desktop renderer UI.
- Say `native bug` when the problem is in the React Native app shell or native app flows.
- Say `mobile editor bundle` when the problem is in the embedded web editor used by native.

## Avoid

- Avoid using `mobile` by itself when the distinction matters.
- Avoid using `app` by itself when the distinction matters.
- Avoid using `renderer` as a synonym for `native`.

## Examples

- `Fix native doc list spacing`
- `Fix electron sidebar toggle`
- `Fix core invite permission check`
- `Update mobile editor bundle toolbar layout`
