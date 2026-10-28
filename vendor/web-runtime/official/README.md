# OpenBone integration with official Spine WebGL

[English](README.md) | [简体中文](README.zh-CN.md)

This integration uses the upstream Spine runtime directly for animation, skin activation, all constraint types, clipping, weighted and linked meshes, sequences, tint black, inheritance, events and AnimationState mixing. It does not reimplement these features or route missing Web behavior to Java.

The user explicitly authorized downloading and developing against the official `4.3/spine-ts` project on 2026-10-28. Upstream source is checked out at `target/spine-runtimes-4.3`, commit `ee2a10936a103ac187d74f7709f855653e923eae`, with `spine-core/src` and `spine-webgl/src` selected. OpenBone itself is always read from this local repository.

## Build and run

```powershell
npm.cmd --prefix web-runtime/official ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix web-runtime/official run build
npm.cmd --prefix web-runtime run demo
```

Open <http://127.0.0.1:8127/web-runtime/official/>. The included synthetic example demonstrates sequence frames, linked-mesh deform inheritance and tint-black animation using the existing project-authored diagnostic texture. English is the default; Simplified/Traditional Chinese controls are available.

`package-lock.json` pins official WebGL **4.2.120** and **4.3.13**, including their core dependencies and registry integrity hashes. `prepare.js` copies the upstream self-contained ESM builds unchanged into `dist/`, with a separate license for each build and `upstream.json` SHA-256 receipts. No CDN or package download occurs during playback. The source integration and SDK builds are kept distinct; no upstream core patch is currently necessary.

Serve the entire `web-runtime/` layout, including `src/` and `official/dist/`, or bundle it for your application. The integration is private and has not been published to npm.

## Embed

```js
import {loadOfficial, OFFICIAL_RUNTIME_INFO} from './web-runtime/official/adapter.js';
const player = await loadOfficial(canvas, '/character/current.json');
player.setAnimation('walk', true);
const camera = player.bounds(); // Capture a suitable fixed game camera.
const events = player.update(1 / 60);
player.render({camera});
player.mixTo('run', 0.2, true);
player.setTrack(1, 'upper-body', {alpha: 0.5, additive: true});
player.seek(0.5); // Deterministically replay recorded playback commands; no events.
const png = player.capture();
player.dispose(); // Cancel your animation loop first. Idempotent.
```

Types are in `index.d.ts`. `player.sdk`, `data`, `skeleton`, `state`, and `scene` expose the native official APIs for capabilities beyond the convenience wrapper. Native objects are recreated by seek/skin replay; reacquire references afterward. Direct native modifications are controlled by the embedding application and are not automatically recorded by the wrapper.

Original version identity is retained in `player.source.version`. 4.2 and 4.3 JSON/binary use their matching official readers without changing headers. The old 3.8/4.0/4.1 OpenBone-supported subset can be normalized by the independent wire/schema adapter into 4.2. This does not broaden the old-format subset to all historical Spine features. Unknown/prerelease versions fail explicitly. `.spine` editor projects are not runtime exports.

OpenBone immutable package loading verifies every manifest file before the official parser/texture loader consumes it. Standalone JSON/binary supports an explicit `atlasUrl` and cancellation. All texture pages are uploaded with premultiplied colors; already-PMA texels are retained and straight pages are premultiplied during bitmap decoding. Both runtime lines use a two-color WebGL renderer. Teardown clears AnimationState listeners/tracks, shaders/buffers, atlas textures, context listeners and decoded bitmaps.

Playback and seek share a clock. Physics advances at 60 Hz; sub-tick display uses official `Physics.pose`. Seek recreates state and replays the recorded animation/mix/track commands, including command times between ticks. The Java-compatible physics replay horizon is 600 seconds. Nonphysics playback is not restricted to that horizon. This wrapper is new OpenBone integration behavior; it is not an upstream Spine editor feature.

## License and validation

The official runtime is governed by the [Spine Runtimes license](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/LICENSE) and the linked Spine Editor terms. The [upstream README](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/spine-ts/README.md) permits free evaluation and explains integration/distribution conditions. Keep the supplied copyright/license notices with distributions. This integration does not establish that the user or a distributor holds a paid Spine license.

The upstream README states that WebGL/player support all Spine features; Canvas does not. Our executed acceptance is narrower and measurable: 132 combinations of synthetic Java-exported 4.2/4.3 JSON/binary scenes render in Chrome WebGL, backward/repeated seeks reproduce the same matrices, and separate checks exercise native sequence frames, linked deform inheritance, tint black, crossfades, additive tracks and command replay. See [CAPABILITIES.md](../CAPABILITIES.md), `tools/browser-capabilities.js` and `target/web-runtime-browser-receipt.json`.

Run the fixture generation and browser commands in the parent README. Do not equate use of the upstream package with certification of every Spine asset or device. Mobile/Safari/Firefox, context recovery and production performance have not been accepted here.
