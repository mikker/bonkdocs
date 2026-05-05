# Bonk Docs Nomenclature

- `core`: shared Electron worker backend under `packages/bonkdocs-core/`.
- `electron`: desktop host in `electron/` plus renderer UI in `renderer/`.
- `Pear Space`: one replicated document space managed by `pear-sdk/spaces`.
- `Pear profile`: local identity/profile state owned by `SpaceManager`.

Native/mobile was removed from this rewrite scope. Do not use `native` to mean a narrow Electron window.
