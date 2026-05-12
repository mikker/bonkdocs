# Bonk Docs Roadmap

## Phase 0 — Pear SDK Rewrite

- Replace Autobonk contexts with `pear-sdk/spaces`.
- Replace custom Yjs routing with `pear-sdk-yjs`.
- Keep Electron UI close to the current Bonk Docs surface.
- Remove external identity linking and use Pear profile identity.
- Add a generic Pear SDK lock capability and dogfood it for document locks.

## Phase 1 — MVP Hardening

- Verify create/open/rename/edit/watch flows under Electron.
- Verify invite create/join/revoke with multiple local stores.
- Add focused brittle coverage for Pear Space document sync.
- Tighten lock semantics: release/force-release UI, stale lock handling, permission tests.

## Phase 2 — SDK Feedback

- Promote lock capability docs/tests in `../pear-sdk`.
- Evaluate whether lock ownership should support leases, reasons, and force permissions.
- Feed Bonk Docs findings back into Pear Spaces API ergonomics.

## Later

- Rebuild native on the new core after Electron stabilizes.
- Add comments/assets/history as Pear Space modules or SDK capabilities.
