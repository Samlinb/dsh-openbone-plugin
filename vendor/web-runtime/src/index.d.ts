export type Matrix = [number, number, number, number, number, number];
export type Point = [number, number];
export interface Bounds { x: number; y: number; width: number; height: number }
export interface Draw {
  slot: string; attachment: string; page: string; pma: boolean; blend: 'normal' | 'additive' | 'multiply' | 'screen';
  color: number[]; dark: number[]; vertices: Point[]; uvs: Point[]; triangles: number[];
}
export interface AttachmentGeometry { slot: string; attachment: string; vertices: Point[] }
export interface Pose { animation: string | null; time: number; skin: string | undefined; bones: Matrix[]; draws: Draw[]; paths: AttachmentGeometry[]; clips: AttachmentGeometry[]; boundingBoxes: AttachmentGeometry[] }
export class RuntimeError extends Error { code: string; path: string }
export class SkeletonData {
  constructor(input: unknown);
  readonly sourceVersion: string;
  readonly warnings: ReadonlyArray<{code: string; path: string}>;
  readonly bones: ReadonlyArray<{name: string; parent: number}>;
  readonly slots: ReadonlyArray<{name: string}>;
  readonly skins: ReadonlyMap<string, unknown>;
  readonly animations: ReadonlyMap<string, {duration: number}>;
  createSkeleton(): Skeleton;
}
export interface AnimationEvent { name: string; absoluteTime: number; track?: number; time?: number; int?: number; float?: number; string?: string }
export class Skeleton {
  constructor(data: SkeletonData);
  readonly data: SkeletonData;
  skin: string | undefined; animation: string | null; time: number; loop: boolean;
  setSkin(name: string): this;
  setAnimation(name: string, loop?: boolean): this;
  /** Crossfade local samples before constraint solving. Interrupted transitions freeze their current source sample. */
  mixTo(name: string, durationSeconds: number, loop?: boolean): this;
  /** Indices 1–64, applied in ascending order; only keyed bone channels replace the lower track. */
  setTrack(index: number, name: string, options?: {alpha?: number; additive?: boolean; loop?: boolean; time?: number}): this;
  clearTrack(index: number): this;
  resetPhysics(): this;
  seek(time: number): this;
  /** Emits events in (previousTime, newTime]. seek() emits no events. Audio is not played automatically. */
  update(deltaSeconds: number): AnimationEvent[];
  evaluate(atlas: TextureAtlas): Pose;
}
export interface AtlasPage { name: string; width: number; height: number; pma: boolean; filter: string }
export interface AtlasRegion {
  name: string; page: string; degrees: number; pma: boolean; x: number; y: number;
  width: number; height: number; originalWidth: number; originalHeight: number; offsetX: number; offsetY: number;
}
export class TextureAtlas {
  constructor(text: string);
  readonly pages: Map<string, AtlasPage>; readonly regions: Map<string, AtlasRegion>;
  uv(region: AtlasRegion, u: number, v: number, packed?: boolean): Point;
}
export interface Assets {
  data: SkeletonData; atlas: TextureAtlas; images: Map<string, ImageBitmap>;
  source: {entryUrl: string; skeletonUrl: string; version: string; manifestSHA256: string | null};
  dispose(): void;
}
export function load(url: string, options?: {atlasUrl?: string; signal?: AbortSignal; decodeImages?: boolean}): Promise<Assets>;
/** Decode stable 3.8/4.0/4.1/4.2/4.3 wire data into canonical OpenBone JSON and retain source identity. */
export function decodeBinary(bytes: Uint8Array | ArrayBuffer): {json: unknown; version: string};
export const SUPPORTED_VERSIONS: readonly string[];
export const RUNTIME_INFO: Readonly<{name: string; version: string; baseline: string}>;
export function bounds(pose: Pose): Bounds;
export class WebGLRenderer {
  constructor(canvas: HTMLCanvasElement);
  readonly canvas: HTMLCanvasElement; readonly gl: WebGLRenderingContext;
  setAssets(assets: Assets): this;
  render(pose: Pose, options?: {camera?: Bounds; padding?: number; background?: number[]}): void;
  capture(type?: string, quality?: number): string;
  dispose(): void;
}
