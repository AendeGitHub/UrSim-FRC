// The REBUILT field (FRC 2026), built from the sizes in the Game Manual, section 5.
// Inches are the manual's; everything in the game is in meters.
//
// Axes: x runs along the field (red ALLIANCE WALL at -x, blue at +x), z across it, y up.
// The field is the same for both alliances turned half a turn: a blue element sits at (-x, -z)
// of the red one.

import type { Alliance } from '../robot/robotConfig';

export const IN = 0.0254;

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Carpet: 651.2 in by 317.7 in (5.2) */
export const FIELD = {
  length: 651.2 * IN,
  width: 317.7 * IN,
  /** Guardrails along the long sides (5.2) */
  rail: 20 * IN,
  /** ALLIANCE WALL height (drawn; robots can't reach over it) */
  wall: 78 * IN,
} as const;

export const HALF_L = FIELD.length / 2;
export const HALF_W = FIELD.width / 2;

/** ALLIANCE ZONE depth from its wall (5.3) */
export const ALLIANCE_ZONE = 158.6 * IN;

/** HUB (5.4): a 47 in square prism, the top opening's front edge 72 in off the carpet. */
export const HUB = {
  size: 47 * IN,
  height: 72 * IN,
  /** The hexagonal top opening, across */
  opening: 41.7 * IN,
  /** Distance of the HUB center from its ALLIANCE WALL: the HUB starts where the ALLIANCE ZONE ends */
  fromWall: 158.6 * IN + (47 * IN) / 2,
  /** The HUB's own funnel floor, where a ball has clearly gone in */
  floor: 1.25,
  /** AprilTags on the HUB (5.11) */
  tagHeight: 44.25 * IN,
} as const;

/** BUMP (5.5): on either side of the HUB, two HDPE ramps at 15° */
export const BUMP = {
  width: 73 * IN,
  depth: 44.4 * IN,
  height: 6.513 * IN,
} as const;

/** TRENCH (5.6): from the guardrail to the BUMP; robots drive under its arm */
export const TRENCH = {
  width: 65.65 * IN,
  depth: 47 * IN,
  height: 40.25 * IN,
  clearWidth: 50.34 * IN,
  clearHeight: 22.25 * IN,
  tagHeight: 35 * IN,
} as const;

/** DEPOT (5.7): along the ALLIANCE WALL, 24 FUEL at the start (6.3.4) */
export const DEPOT = {
  width: 42 * IN,
  depth: 27 * IN,
  barrier: 1.125 * IN,
  fuel: 24,
} as const;

/** TOWER (5.8): built into the ALLIANCE WALL between DRIVER STATIONS 2 and 3 */
export const TOWER = {
  width: 49.25 * IN,
  depth: 45 * IN,
  height: 78.25 * IN,
  baseWidth: 39 * IN,
  baseDepth: 45.18 * IN,
  uprightHeight: 72.1 * IN,
  uprightGap: 32.25 * IN,
  uprightThick: 1.5 * IN,
  uprightDeep: 3.5 * IN,
  rungRadius: (1.66 * IN) / 2,
  rungOverhang: 5.875 * IN,
  /** LOW, MID, HIGH rung centers off the carpet */
  rungs: [27 * IN, 45 * IN, 63 * IN] as const,
} as const;

/** OUTPOST (5.9): a corner of the alliance end with a CHUTE of 24 FUEL and a CORRAL at its base */
export const OUTPOST = {
  width: 35.8 * IN,
  depth: 37.6 * IN,
  wallHeight: 8.13 * IN,
  fuel: 24,
} as const;

/** FUEL (5.10.1): a 15 cm high density foam ball, 0.203–0.227 kg */
export const FUEL = {
  radius: 0.075,
  mass: 0.215,
  total: 504,
  preload: 8,
  /** The NEUTRAL ZONE pile is corralled in a box this size before the match (6.3.4) */
  pileAcross: 206 * IN,
  pileAlong: 72 * IN,
} as const;

/** Each element's spot for the RED alliance; blue ones are turned half a turn (mirror()). */
export const RED = {
  wallX: -HALF_L,
  hub: [-HALF_L + HUB.fromWall, 0] as Vec2,
  /** BUMPS either side of the HUB */
  bumps: [
    [-HALF_L + HUB.fromWall, HUB.size / 2 + BUMP.width / 2],
    [-HALF_L + HUB.fromWall, -(HUB.size / 2 + BUMP.width / 2)],
  ] as Vec2[],
  /** TRENCHES from the BUMP to the guardrail (the carpet is a little narrower than the parts add up to) */
  trenches: [1, -1].map(s => [-HALF_L + HUB.fromWall, s * (HALF_W - (HALF_W - HUB.size / 2 - BUMP.width) / 2)] as Vec2),
  trenchWidth: HALF_W - HUB.size / 2 - BUMP.width,
  // Across the field (z) the manual gives no positions: these come from the field CAD
  // (Team Practice Field, tools/convert-field.mjs → public/assets/field-layout.json).
  /** TOWER built into the wall between DRIVER STATIONS 2 and 3 */
  tower: [-HALF_L + TOWER.depth / 2, 0.295] as Vec2,
  /** DEPOT along the wall on the DRIVER STATION 1 side */
  depot: [-HALF_L + DEPOT.depth / 2, -1.937] as Vec2,
  /** OUTPOST behind the wall in the DRIVER STATION 3 corner: the human player rolls FUEL in here */
  outpost: [-HALF_L + 0.25, 3.48] as Vec2,
  /** DRIVER STATIONS 1–3 along the wall (for the camera and robot starts) */
  stations: [-2.6, -0.9, 2.2] as number[],
} as const;

export function mirror(p: Vec2): Vec2 {
  return [-p[0], -p[1]];
}

/** A point given for red, placed for `alliance`. */
export function place(alliance: Alliance, p: Vec2): Vec2 {
  return alliance === 'red' ? [p[0], p[1]] : mirror(p);
}

/** Which way is "into the field" from an alliance's wall: +1 along x for red, -1 for blue. */
export const intoField = (alliance: Alliance): number => (alliance === 'red' ? 1 : -1);

export const hubCenter = (alliance: Alliance): Vec2 => place(alliance, RED.hub);
export const towerCenter = (alliance: Alliance): Vec2 => place(alliance, RED.tower);

/** Whether (x, z) is in an alliance's own ALLIANCE ZONE. */
export function inAllianceZone(alliance: Alliance, x: number): boolean {
  return alliance === 'red' ? x < -HALF_L + ALLIANCE_ZONE : x > HALF_L - ALLIANCE_ZONE;
}

/** Whether (x, z) is in the NEUTRAL ZONE (between the HUB lines). */
export function inNeutralZone(x: number): boolean {
  return Math.abs(x) < HALF_L - HUB.fromWall - HUB.size / 2;
}

/**
 * Where every FUEL starts. The order is fixed (ids match between the physics and the picture):
 * the NEUTRAL ZONE pile, then the DEPOTS, then the CHUTES, then the robots' pre-loads.
 */
export interface FuelStart {
  where: 'neutral' | 'depot' | 'chute' | 'preload';
  alliance?: Alliance;
  /** Robot slot index 0–5 (preloads) */
  slot?: number;
  pos: Vec3;
}

/** A small deterministic random generator, so every match starts the same way (and tests repeat). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fuelStarts(seed = 2026): FuelStart[] {
  const r = rng(seed);
  const out: FuelStart[] = [];
  const preloads = 6 * FUEL.preload;
  const neutral = FUEL.total - 2 * DEPOT.fuel - 2 * OUTPOST.fuel - preloads;
  // The pile: a grid of 34 x 12 spots in the 5.23 x 1.83 m box, filled except for a few random gaps.
  const d = FUEL.radius * 2 + 0.003;
  const nz = Math.floor(FUEL.pileAcross / d);
  const nx = Math.floor(FUEL.pileAlong / d);
  const spots: Vec3[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      spots.push([(i - (nx - 1) / 2) * d, FUEL.radius, (j - (nz - 1) / 2) * d]);
    }
  }
  while (spots.length > neutral) spots.splice(Math.floor(r() * spots.length), 1);
  // Short of spots: the rest are stacked on top.
  for (let k = 0; spots.length < neutral; k++) {
    const s = spots[k];
    spots.push([s[0] + d / 2, FUEL.radius * 2.6, s[2] + d / 2]);
  }
  for (const pos of spots) out.push({ where: 'neutral', pos });
  for (const alliance of ['red', 'blue'] as const) {
    const [cx, cz] = place(alliance, RED.depot);
    for (let i = 0; i < DEPOT.fuel; i++) {
      const ix = i % 4, iz = Math.floor(i / 4);
      out.push({ where: 'depot', alliance, pos: [cx + (ix - 1.5) * d * 1.05, FUEL.radius, cz + (iz - 2.5) * d * 1.05] });
    }
  }
  for (const alliance of ['red', 'blue'] as const) {
    for (let i = 0; i < OUTPOST.fuel; i++) out.push({ where: 'chute', alliance, pos: [0, -10 - i, 0] });
  }
  for (let slot = 0; slot < 6; slot++) {
    for (let i = 0; i < FUEL.preload; i++) out.push({ where: 'preload', slot, pos: [slot, -20 - i, 0] });
  }
  return out;
}
