# OpenBone Web Runtime 0.2

[English](README.md) | [简体中文](README.zh-CN.md)

Browser playback for OpenBone exports, with two explicit implementations:

- **Official Spine WebGL integration**: use [official/README.md](official/README.md) for native Spine 4.2/4.3 features, official AnimationState mixing, linked meshes, sequences and tint black. It includes pinned upstream packages and their licenses. This is the preferred route when the full official runtime is required.
- **Independent OpenBone runtime**: `src/index.js`, with no Spine dependency. It follows the local Java model's animation, constraint and geometry contracts. It now includes IK, transform, path and fixed-step physics constraints, clipping, all five inheritance modes, skin activation, weighted paths and deforms, plus documented mixing/sequence/tint extensions.

Neither implementation requires a JVM or editor connection at playback. The DSH plugin has not been modified. The audited Java baseline, source evidence, format boundaries and test receipts are in [CAPABILITIES.md](CAPABILITIES.md). This is not a claim of universal Spine compatibility for the independent implementation.

## Run

Node.js 20 or newer:

```powershell
npm.cmd --prefix web-runtime/official ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix web-runtime/official run build
npm.cmd --prefix web-runtime run demo
```

Official player: <http://127.0.0.1:8127/web-runtime/official/>. Independent player: <http://127.0.0.1:8127/web-runtime/demo/>. The fixed loopback port reports conflicts. The development server serves this repository; deploy only the needed static assets on a normal HTTP(S) host. Preserve atlas-relative PNG paths and configure CORS when origins differ.

## Independent embed

```js
import {load, WebGLRenderer, bounds, RUNTIME_INFO} from './web-runtime/src/index.js';
const assets = await load('/character/current.json');
const skeleton = assets.data.createSkeleton().setAnimation('walk', true);
const renderer = new WebGLRenderer(canvas).setAssets(assets);
const camera = bounds(skeleton.evaluate(assets.atlas));
skeleton.update(1 / 60);
renderer.render(skeleton.evaluate(assets.atlas), {camera});
// skeleton.mixTo('run', 0.2);
// skeleton.setTrack(1, 'upper-body', {alpha: 0.5, additive: true});
const png = renderer.capture();
// On teardown, cancel your animation frame before releasing resources:
renderer.dispose();
assets.dispose();
```

The public declarations are in `src/index.d.ts`. `RUNTIME_INFO` identifies the implementation; `assets.source.version` retains the input version. `decodeBinary(bytes)` returns canonical JSON and the original version. Stable 3.8, 4.0, 4.1, 4.2 and 4.3 JSON/binary families are supported within the matrix; unknown/prerelease versions fail explicitly. Native `.spine` and editable OpenBone project files are not runtime inputs.

`load(url, {signal, atlasUrl})` accepts OpenBone `current.json`, standalone `.json`, `.skel`, and `.skel.bytes`. Packages are resolved once and all manifest files are SHA-256 checked before texture decoding; atlas pages must be listed. SHA-256 detects byte mismatches, not publisher identity. Limits: 64 MiB per resource, 16 MiB manifests/atlases, 256 MiB per package, 10,000 files, 8192 texture pixels per axis. Path escapes and redirects fail. `assets.dispose()` closes decoded bitmaps; `renderer.dispose()` deletes owned GL resources. Both are idempotent.

## Time and coordinates

Seconds; X right/Y up; counterclockwise degrees; matrices `[a,b,c,d,tx,ty]`; image-space UV Y down. Translation, rotation and shear keys add to setup; scale multiplies setup. Ten-chord Bezier sampling preserves turns. `seek()` emits no events. `update()` emits events in `(previousTime, newTime]`, with optional track identity; audio metadata is returned without automatic sound playback.

Physics uses Java's deterministic 60 Hz reset/update/pose contract. Backward seek, animation/skin changes and loop seams replay as required; no integration occurs during sub-tick display. The Java physics horizon is 600 seconds / 36,000 ticks. There is no epsilon that advances a tick just before its boundary.

Independent crossfades blend local transforms/constraint parameters before solving. Layer indices 1–64 apply in ascending order and preserve unkeyed bone channels. Additive bone layers add offsets from setup. Discrete attachments/draw order switch at half alpha. Interrupted crossfades freeze their current source sample. This API is OpenBone behavior, not the full Spine AnimationState contract; use the official adapter for that contract.

The independent loader accepts linked meshes with same-slot parent/deform inheritance, seven sequence playback modes, RGB/RGBA two-color timelines, multiply and screen. Binary extensions outside Java's decoder contract (such as sequence/two-color binary fields) remain explicit errors. The official 4.2/4.3 reader handles those native formats directly.

## Verify

```powershell
mvn.cmd '-Dtest=WebRuntimeFixtureTest,WebRuntimeCapabilitiesTest' '-Dopenbone.webRuntime=true' test
$env:OPENBONE_WEB_FIXTURE = (Resolve-Path target/web-runtime-fixture).Path
$env:OPENBONE_WEB_CAPABILITIES = (Resolve-Path target/web-runtime-capabilities).Path
npm.cmd --prefix web-runtime test
# With the development server running and Chrome installed:
node web-runtime/tools/browser-smoke.js
node web-runtime/tools/browser-capabilities.js
```

The Java tests generate real importer/exporter and solver oracles, not hand-authored expected poses. The capability suite covers 39 scenes, including model domains outside conservative float export certificates, reverse/repeated seeks, loop endpoints, skin selection and the representable five-family JSON/binary exports. The browser receipt records 800 independent WebGL frames, 19,320 matrix comparisons, 132 official 4.2/4.3 JSON/binary render cases, official sequence/linked deform/tint/mixing checks and resource disposal. See `target/web-runtime-browser-receipt.json`, `target/web-runtime-capabilities.png`, and `target/web-runtime-smoke.png`.

Executed on Windows Chrome using ANGLE/SwiftShader: actual browser WebGL, not hardware-GPU certification. Mobile, Firefox, Safari, context restoration and production performance remain unverified. Fit samples 61 poses and is an approximate camera bound.
