# Audited Web runtime capability matrix

[English](CAPABILITIES.md) | [简体中文](CAPABILITIES.zh-CN.md)

Audit date: 2026-10-28. Baseline: the local OpenBone Java model, animation sampler, importer/exporter and viewport geometry. Native editor project graphs and all historical Spine capabilities are not inferred from that baseline. The user's subsequent authorization permits an additional official Spine runtime integration; the independent implementation remains separate.

| Capability | Local Java baseline / source | Independent Web 0.2 | Official WebGL adapter |
| --- | --- | --- | --- |
| Bone translation/rotation/scale/shear, signed scales | `AnimationSampler`, `Affine2`, `Transform` | Setup-relative keys, preserved turns, split/paired axes | Native upstream |
| Five inheritance modes | `BoneInheritance.world` | Reflected/nonuniform/sheared parent fixtures | Native matching version |
| Linear/stepped/Bezier curves | `Curve.progress`, `SpineBezierChords` | Ten-chord absolute controls; legacy relative conversion | Native upstream |
| One/two-bone IK, bend, softness, compress/stretch/uniform | `ConstraintSolver.single/two/ellipse` | Implemented; reflected/nonuniform and stepped parameters | Native upstream |
| Transform: local/world × relative/absolute, six mixes/offsets | `TransformConstraintSolver.apply` | Full affine locks and descendant rebuild | Native upstream |
| Path: position/spacing/rotation modes | `PathConstraintSolver` | Four spacing × three rotation modes; open/closed, constant/variable speed | Native upstream |
| Weighted/deform-animated paths | `PathAttachment.worldVertices/chain` | Skin controls before constraint solve; four extra model-domain fixtures | Native upstream |
| Physics: X/Y/rotate/scaleX/shearX, seven parameter tracks | `PhysicsSolver`, `PhysicsPlayer`, `PhysicsEnvelope.tickAt` | 60 Hz replay, mix=0 pause/catch-up, sub-tick pose, reverse/repeated/loop seek | Official physics through recorded 60 Hz commands |
| Region/unweighted/weighted mesh, signed weights | `WorldPose.evaluate`, `Influence` | Per-influence deform before skinning; near-unit import normalization with diagnostics | Native upstream |
| Concave clipping and end slot | `VisibleGeometry`, `PolygonClipper`, `MeshTopology` | UV interpolation; decimal BigInt predicates near cancellation; frame-local clip state | Native upstream |
| Weighted/deformed clipping | `ClippingAttachment`, `WorldPose` | Compared to Java clipped area and UVs | Native upstream |
| Bounding box/path geometry queries | Sealed `Attachment` kinds, `WorldPose` | `pose.boundingBoxes`, `paths`, `clips` | Native skeleton/bounds APIs |
| Skin-controlled bones/ancestors/constraints | `SkinActivation`, `DocumentSnapshot.resolvedSlots` | Selected membership; default attachment fallback does not activate default members | Native upstream |
| Attachment/order/color/event timelines | `DiscreteTracks`, `SlotColorTimeline`, `EventSampler` | Event loop interval and layer identity | Native AnimationState/listeners |
| Atlas pages/trim/quarter turns/filter/straight/PMA | `AtlasRegion`, `TexturedScene` | Rotation/PMA texel checks | Native atlas; integration uploads all pages as PMA |
| Normal/additive blend | `Slot.Blend`, `TexturedScene` | Implemented | Native upstream |
| Linked mesh | Old Java binary adapters materialize same-slot linked meshes; no linked model type | JSON/decoded old binary chains, cycle checks and deform inheritance | Native matching-version links, including 4.3 source/timelines |
| Sequence, tint black, multiply/screen | Outside Java model/export baseline | Documented JSON extensions/shader | Native upstream; actual-render checks |
| Crossfade/multiple additive/normal tracks | Java has sequential playback, not AnimationState | OpenBone local-sample mixing, documented discrete thresholds | Native AnimationState; full API exposed |
| 4.3 sliders/remapped transforms, global/reset physics, inherit timelines, points | Outside Java baseline | Explicitly rejected | Matching official runtime; not all individually accepted here |
| Package/cancellation/version/capture/disposal | `ExportPackage` contract | Implemented | Integration around native parser/GL |

Java float export certificates are narrower than its editable double model. Some continuously animated constraints, constrained path parents, physics combinations and downgrades fail before publication. Web work does not remove Java guards. Extra weighted path/clipping fixtures are marked as importer/model checks, not certified exported packages.

## Formats

| Input | Independent runtime | Official adapter |
| --- | --- | --- |
| Stable 3.8 JSON/later-layout binary | Java-supported schema/wire subset; relative curves, old mixes/deform names | Normalize same subset to 4.2 |
| Stable 4.0/4.1 JSON/binary | Java-supported subset, including old linked binary layouts | Normalize same subset to 4.2 |
| Stable 4.2 JSON/binary | Java subset plus documented JSON extensions | Unmodified official 4.2 reader |
| Stable 4.3 JSON/binary | Representable Java constraint/property subset | Unmodified official 4.3 reader |
| `current.json` | Immutable generation, all resource hashes verified | Integrity boundary before official parsing |
| 3.8.75 binary, unknown families, beta versions | Explicit error | Explicit error at adapter boundary |
| Native `.spine` or OpenBone editable project | Not runtime inputs | Not runtime inputs |

Upstream 4.3 does not parse 4.2 data. The adapter selects an exact pinned family and retains the source version. Independent binary sequence/two-color and other fields outside Java's decoder contract remain errors; `loadOfficial` passes matching 4.2/4.3 native data directly to the official reader.

## Executed acceptance

- Java: 39 scenes, all skins, non-monotonic/repeated times, loop endpoints and immediately-before/on-tick times. Representable scenes export across five JSON/binary families. Weighted mesh/absolute curves separately cover all five formats.
- Node: 55 tests with generated fixture paths enabled, no skips; named matrices, textured vertices/UV/color, clipping area/UV, sequences, links, mixing and malformed binary.
- Independent Chrome WebGL: 800 frames, 19,320 matrix comparisons, GL errors/nonempty checks and resource disposal. Authored texels verify tint-black, multiply/screen, PMA, additive and UV rotation.
- Official Chrome WebGL: 132 combinations of 4.2/4.3 JSON/binary; reverse/repeated-seek reproduction; native sequence `[0,1,2,3]`, linked deform, tint black, crossfade, additive tracks and command replay between fixed ticks.
- Evidence: `target/web-runtime-browser-receipt.json`, `target/web-runtime-capabilities.png`, `target/web-runtime-smoke.png`. Screenshots contain captured renders, not simulated viewport images.

Windows Chrome uses ANGLE Vulkan/SwiftShader. Hardware GPUs, mobile, Safari/Firefox, context recovery, licensed native editor conversion and production-scale performance remain unverified. Upstream's full-feature support statement is distinct from these measurements.
