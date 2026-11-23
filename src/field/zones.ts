// REBUILT zones (manual 5.3) and the field elements' footprints, with geometry helpers.
// Red alliance at -X, audience at +Z; blue zones are the red ones turned half a turn about the center.

import { ALLIANCE_ZONE, DEPOT, HUB, OUTPOST, RED } from '../frc/field';
import type { Alliance } from '../robot/robotConfig';
import type { Box3, FieldLayout, Vec3 } from './layout';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Zones {
  /** Inner faces of the ALLIANCE WALLS (x) and guardrails (z) */
  halfX: number;
  halfZ: number;
  /** ALLIANCE ZONES: from the ALLIANCE WALL to the HUB's near edge (the ROBOT STARTING LINE) */
  alliance: Record<Alliance, Rect>;
  /** Between the two HUBS' far edges */
  neutral: Rect;
  /** HUB centers (x, z) and footprints */
  hub: Record<Alliance, [number, number]>;
  hubRect: Record<Alliance, Rect>;
  /** The TOWER's footprint on the carpet (in front of the ALLIANCE WALL) */
  tower: Record<Alliance, Rect>;
  depot: Record<Alliance, Rect>;
  /** Where the OUTPOST's CHUTE lets FUEL into the field */
  outpost: Record<Alliance, [number, number]>;
  /** BUMPS (robots drive over) and TRENCHES (robots drive under), both alliances */
  bumps: Rect[];
  trenches: Rect[];
}

export const mirrorRect = (r: Rect): Rect => ({ minX: -r.maxX, maxX: -r.minX, minZ: -r.maxZ, maxZ: -r.minZ });
const both = (red: Rect): Record<Alliance, Rect> => ({ red, blue: mirrorRect(red) });
const boxRect = (b: Box3): Rect => ({ minX: b.min[0], maxX: b.max[0], minZ: b.min[2], maxZ: b.max[2] });

export function buildZones(layout: FieldLayout): Zones {
  const { halfX, halfZ } = layout.wall;
  const hubX = -halfX + HUB.fromWall;
  const hubRed: Rect = { minX: hubX - HUB.size / 2, maxX: hubX + HUB.size / 2, minZ: -HUB.size / 2, maxZ: HUB.size / 2 };
  const towerBox = layout.elements.tower_red;
  const tower: Rect = { ...boxRect(towerBox), minX: -halfX };
  const depot: Rect = { minX: -halfX, maxX: -halfX + DEPOT.depth, minZ: RED.depot[1] - DEPOT.width / 2, maxZ: RED.depot[1] + DEPOT.width / 2 };
  // BUMPS beside each HUB and TRENCHES from them to the guardrails, as wide as the HUB is deep.
  const bumps: Rect[] = [];
  const trenches: Rect[] = [];
  const bumpBox = layout.elements.bumps;
  for (const s of [1, -1]) {
    const bumpRed: Rect = { minX: hubRed.minX, maxX: hubRed.maxX, minZ: s > 0 ? hubRed.maxZ : -bumpBox.max[2], maxZ: s > 0 ? bumpBox.max[2] : hubRed.minZ };
    const trenchRed: Rect = { minX: hubRed.minX, maxX: hubRed.maxX, minZ: s > 0 ? bumpBox.max[2] : -halfZ, maxZ: s > 0 ? halfZ : -bumpBox.max[2] };
    bumps.push(bumpRed, mirrorRect(bumpRed));
    trenches.push(trenchRed, mirrorRect(trenchRed));
  }
  const outpostZ = (layout.elements.outpost_red.min[2] + layout.elements.outpost_red.max[2]) / 2;
  return {
    halfX,
    halfZ,
    alliance: both({ minX: -halfX, maxX: -halfX + ALLIANCE_ZONE, minZ: -halfZ, maxZ: halfZ }),
    neutral: { minX: hubRed.maxX, maxX: -hubRed.maxX, minZ: -halfZ, maxZ: halfZ },
    hub: { red: [hubX, 0], blue: [-hubX, 0] },
    hubRect: both(hubRed),
    tower: both(tower),
    depot: both(depot),
    outpost: { red: [-halfX + 0.2, outpostZ], blue: [halfX - 0.2, -outpostZ] },
    bumps,
    trenches,
  };
}

/** The OUTPOST CHUTE's FUEL, for the human player (manual 6.3.4) */
export const CHUTE_FUEL = OUTPOST.fuel;

export const rectCenter = (r: Rect): [number, number] => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];

export const inRect = (x: number, z: number, r: Rect, margin = 0): boolean =>
  x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin;

/** Ball at least partially inside a floor zone. */
export function ballInRect(p: Vec3, radius: number, r: Rect): boolean {
  return p[0] > r.minX - radius && p[0] < r.maxX + radius && p[2] > r.minZ - radius && p[2] < r.maxZ + radius && p[1] < 0.3;
}

/** Corners (x, z) of a robot footprint. Yaw 0 faces +X; right is +Z. */
export function footprint(x: number, z: number, yaw: number, length: number, width: number): [number, number][] {
  const fx = Math.cos(yaw), fz = -Math.sin(yaw);
  const rx = Math.sin(yaw), rz = Math.cos(yaw);
  const corners: [number, number][] = [];
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    corners.push([x + (fx * a * length) / 2 + (rx * b * width) / 2, z + (fz * a * length) / 2 + (rz * b * width) / 2]);
  }
  return corners;
}

/** Separating-axis test: convex polygon vs axis-aligned rectangle. */
export function polygonOverlapsRect(poly: [number, number][], r: Rect): boolean {
  return polygonsOverlap(poly, [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]]);
}

/** Separating-axis test: two convex polygons (touching counts as overlapping). */
export function polygonsOverlap(p: [number, number][], q: [number, number][]): boolean {
  const axes: [number, number][] = [];
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      axes.push([bz - az, -(bx - ax)]);
    }
  }
  for (const [nx, nz] of axes) {
    const project = (pts: [number, number][]) => pts.map(([px, pz]) => px * nx + pz * nz);
    const a = project(p);
    const b = project(q);
    if (Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a)) return false;
  }
  return true;
}

/** Every corner of the outline is inside the rectangle. */
export const polygonInsideRect = (poly: [number, number][], r: Rect): boolean => poly.every(([x, z]) => inRect(x, z, r));
