// #528 Gainer Balloons: how much detail a scene draws. The full app gets all of it; a card gets
// less, and a small card the least (no rain or snow particles, one cloud layer, coarser balloons).
// No three.js here, so the React shell can pick a level without downloading the scene.
export type SceneQuality = {
  /** Segments around a balloon. */
  lathe: number;
  /** Segments in a string. */
  tether: number;
  /** Rain streaks / snow flakes at full weather (0: none). */
  particles: number;
  /** Cloud layers painted in the sky (1 or 2). */
  cloudLayers: 1 | 2;
  /** The most device pixels per CSS pixel the canvas uses. */
  maxPixelRatio: number;
  /** Frames a second while nobody is touching the scene. */
  idleFps: number;
};

export type SizeClass = "full" | "large" | "medium" | "small";

export const QUALITY: Readonly<Record<SizeClass, SceneQuality>> = {
  full: { lathe: 22, tether: 10, particles: 900, cloudLayers: 2, maxPixelRatio: 2, idleFps: 60 },
  large: { lathe: 18, tether: 8, particles: 500, cloudLayers: 2, maxPixelRatio: 1.5, idleFps: 30 },
  medium: { lathe: 16, tether: 8, particles: 320, cloudLayers: 1, maxPixelRatio: 1.5, idleFps: 30 },
  small: { lathe: 12, tether: 6, particles: 0, cloudLayers: 1, maxPixelRatio: 1.25, idleFps: 24 },
};

/** A card's size class from its box. The full app is always "full". */
export function cardSizeClass(width: number, height: number): Exclude<SizeClass, "full"> {
  if (width >= 560 && height >= 380) return "large";
  if (width >= 360 && height >= 300) return "medium";
  return "small";
}

/** How many ticker labels a scene of this size shows before the rest wait for a tap. */
export function labelBudget(width: number, height: number, compact: boolean): number {
  const area = Math.max(0, width) * Math.max(0, height);
  return Math.round(Math.min(60, Math.max(5, area / (compact ? 22_000 : 14_000))));
}

/** The label's text height in CSS pixels. */
export function labelTextPx(size: SizeClass, width: number): number {
  if (size === "full") return width < 520 ? 12 : 13;
  return size === "small" ? 10.5 : 11;
}
