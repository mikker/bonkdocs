# Facebonk Linking

Bonk Docs now links to Facebonk through a signed profile card instead of joining Facebonk as another local device.

## Scope

- Facebonk remains the only app that creates and edits the shared profile.
- Bonk Docs imports a signed Facebonk profile token and stores the verified card locally.
- Desktop and native can both read the same shared profile without opening Facebonk's Corestore path.

## Flow

1. In Facebonk, run `facebonk profile share`.
2. Copy the emitted `facebonk-profile:...` token.
3. In Bonk Docs, open the Facebonk link dialog and paste the token.
4. The Bonk Docs worker verifies the Ed25519 signature and stores the signed profile card in Bonk Docs storage.
5. The renderer or native host reads the stored summary and uses it for local presence labels and avatars.

## Current behavior

- The worker still exposes `getIdentity`, `linkIdentity`, and `resetIdentity` over HRPC, but they now operate on signed profile cards.
- `initialize` returns the linked Facebonk profile summary when present.
- The sidebar shows the linked Facebonk profile.
- Local presence labels prefer the linked Facebonk display name and avatar instead of a raw writer key.

## Current limits

- This does not yet attach a signed `profileKey` claim to document membership records.
- It is still an app-level shared profile integration, not a full document-level identity system.
