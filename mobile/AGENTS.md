# Native Instructions

These instructions apply to `mobile/`.

- This is the `native` surface: the React Native host app.
- `native` does not mean a mobile-sized `electron` window.
- Keep native host work in `mobile/src/`, `mobile/index.ts`, and related native project files.
- The embedded editor used by `native` is the `mobile editor bundle`, sourced from `renderer/src/mobile-editor/` and generated into `mobile/src/generated/editor-web-bundle.ts`.
- Do not hand-edit `mobile/src/generated/editor-web-bundle.ts` unless there is a very specific reason. Prefer changing the source bundle and regenerating it.
- Fastest native editor loop:
  - Keep the native app running with `npm run mobile:ios` or the equivalent native host command.
  - After changes to `renderer/src/mobile-editor/`, run `npm run mobile:bundle:web-editor`.
