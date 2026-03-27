# Facebonk Linking

Bonk Docs now supports linking to an existing Facebonk identity.

## Scope

- Bonk Docs does not create identities in this POC.
- Facebonk remains the only app that creates and edits the shared profile.
- Bonk Docs only links a local device to an existing identity and reads its summary/profile.

## Flow

1. In Facebonk, create an invite with `facebonk link create`.
2. Keep Facebonk online with `facebonk serve`.
3. In Bonk Docs, open the Facebonk link dialog and paste the invite.
4. The Bonk Docs worker joins the shared identity context in its own local storage.
5. The renderer stores the linked identity summary and uses it for app-level sign-in state.

## Current behavior

- The worker exposes `getIdentity` and `linkIdentity` over HRPC.
- `initialize` now returns the current linked identity summary when present.
- The sidebar shows the linked Facebonk profile.
- Local presence labels prefer the linked identity display name instead of a raw writer key.

## Current limit

- This does not yet attach `identityKey` to document metadata, comments, or invite ACLs.
- It is still an app-level sign-in integration, not full document-level shared identity.
