# Bonk Docs Mobile

First-pass iOS host scaffold for Bonk Docs.

## What exists

- Expo React Native host
- Bare worklet booted with `pear-runtime-react-native`
- shared Bonk Docs backend booted from `packages/bonkdocs-core`
- worker storage rooted in `pear-mobile` storage

## What does not exist yet

- create/join flows
- WebView-hosted editor
- invites UI
- mobile-specific document session state

## Commands

```sh
npm install
npm run bundle:bare
npm run ios
```
