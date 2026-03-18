# Bonk Docs Mobile

First-pass iOS mobile host for Bonk Docs.

## What exists

- Expo React Native host
- Bare worklet booted with `pear-runtime-react-native`
- shared Bonk Docs backend booted from `packages/bonkdocs-core`
- worker storage rooted in `pear-mobile` storage
- document list loading from the shared worker
- create and join flows wired to shared RPC
- open-document screen with a first WebView-backed document surface

## What does not exist yet

- invites UI
- full rich-text editor bridge inside the WebView
- mobile-specific session/store extraction comparable to desktop

## Commands

```sh
npm install
npm run bundle:bare
npm run ios
```
