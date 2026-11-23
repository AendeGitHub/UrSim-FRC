// Where a robot may start a match (manual G303): its BUMPERS overlap its ROBOT STARTING LINE (the
// ALLIANCE-colored line at the edge of its ALLIANCE ZONE, in front of the HUB and the BUMPS), it
// does not touch a BUMP, and it is clear of the field elements and the other robots. Drivers can
// pick a start of their own before a game. Starts are kept as they are on the red side (-X); a blue
// start is the same turned half a turn about the field center, so one saved start works for either
// alliance.

import type { Alliance, RobotConfig } from '../robot/robotConfig';
import { slotAlliance, slotStation, type Slot } from '../sim/types';
import { footprint, polygonOverlapsRect, polygonsOverlap, type Rect, type Zones } from './zones';

export interface StartPose {
  x: number;
  z: number;
  /** Yaw 0 faces +X (away from the red drivers) */
  yaw: number;
}

/** A robot's outline on the floor: corners (x, z) */
export type Outline = [number, number][];

/** The rule a start breaks (G303), in the order they are checked */
export type StartProblem = 'side' | 'line' | 'bump' | 'element' | 'robot';

/** The red side's limits for a start */
export interface StartField {
  halfX: number;
  halfZ: number;
  /** x of the red ROBOT STARTING LINE (the ALLIANCE ZONE's edge) */
  line: number;
  bumps: Rect[];
  /** HUB, TRENCH posts, TOWER and DEPOT: a robot may not start on them */
  elements: Rect[];
}

/** The starting line's tape is 2 in wide, on the ALLIANCE ZONE side of its edge; the bumpers overlap it */
const LINE_WIDTH = 0.05;
/** The usual starts by driver station: in front of the TRENCH on the DEPOT side, the HUB, the other TRENCH */
const STATION_Z: Record<1 | 2 | 3, number> = { 1: -3.35, 2: 0, 3: 3.35 };
/** How far a TRENCH's posts reach in from the guardrail, m */
const TRENCH_POST = 0.12;

export function startField(zones: Zones): StartField {
  const red = (r: Rect) => r.maxX < 0;
  return {
    halfX: zones.halfX,
    halfZ: zones.halfZ,
    line: zones.alliance.red.maxX,
    bumps: zones.bumps.filter(red),
    elements: [
      zones.hubRect.red,
      zones.tower.red,
      ...zones.trenches.filter(red).map(t => ({ ...t, minZ: t.minZ > 0 ? zones.halfZ - TRENCH_POST : t.minZ, maxZ: t.maxZ < 0 ? -zones.halfZ + TRENCH_POST : t.maxZ })),
    ],
  };
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A red-side start as it is for `alliance`, and back (blue: turned half a turn about the field center). */
export function forAlliance(p: StartPose, alliance: Alliance): StartPose {
  return alliance === 'red' ? p : { x: -p.x, z: -p.z, yaw: wrapAngle(p.yaw + Math.PI) };
}

/** A driver station's usual start (red side) for a robot `length` long: bumpers on the line, facing the field. */
export function defaultStart(station: 1 | 2 | 3, length: number, field: Pick<StartField, 'line'>): StartPose {
  return { x: field.line - length / 2 - 0.01, z: STATION_Z[station], yaw: 0 };
}

/** The robot's outline in its STARTING CONFIGURATION. */
export function startOutline(p: StartPose, cfg: RobotConfig): Outline {
  const frame = cfg.frame ?? { length: cfg.length, offset: 0 };
  return footprint(p.x + Math.cos(p.yaw) * frame.offset, p.z - Math.sin(p.yaw) * frame.offset, p.yaw, frame.length, cfg.width);
}

/** Keeps a red-side start inside the field and on its own ALLIANCE ZONE's side of the line. */
export function clampStart(p: StartPose, cfg: RobotConfig, field: StartField): StartPose {
  const outline = startOutline(p, cfg);
  const xs = outline.map(c => c[0]);
  const zs = outline.map(c => c[1]);
  const push = (min: number, max: number, low: number, high: number) => (min < low ? low - min : max > high ? high - max : 0);
  return {
    x: p.x + push(Math.min(...xs), Math.max(...xs), -field.halfX, field.line),
    z: p.z + push(Math.min(...zs), Math.max(...zs), -field.halfZ, field.halfZ),
    yaw: wrapAngle(p.yaw),
  };
}

/** A robot turned in place keeps its bumpers on the line if they were on it before the turn. */
export function keepOnWalls(before: StartPose, turned: StartPose, cfg: RobotConfig, field: StartField): StartPose {
  const front = (p: StartPose) => Math.max(...startOutline(p, cfg).map(c => c[0]));
  const was = front(before);
  if (was < field.line - LINE_WIDTH / 2) return clampStart(turned, cfg, field);
  return clampStart({ ...turned, x: turned.x + (was - front(turned)) }, cfg, field);
}

/** The first rule of G303 a red-side start breaks, or null where the robot may start; `others`: robots already placed on that side. */
export function checkStart(p: StartPose, cfg: RobotConfig, field: StartField, others: readonly Outline[] = []): StartProblem | null {
  const outline = startOutline(p, cfg);
  const xs = outline.map(c => c[0]);
  if (outline.some(([x, z]) => x < -field.halfX - 1e-6 || x > field.line + 1e-6 || Math.abs(z) > field.halfZ + 1e-6)) return 'side';
  if (Math.max(...xs) < field.line - LINE_WIDTH) return 'line';
  if (field.bumps.some(b => polygonOverlapsRect(outline, b))) return 'bump';
  if (field.elements.some(e => polygonOverlapsRect(outline, e))) return 'element';
  if (others.some(o => polygonsOverlap(outline, o))) return 'robot';
  return null;
}

/** A start saved or sent by someone else: null unless it is a pose inside the field. */
export function cleanStart(value: unknown): StartPose | null {
  if (!value || typeof value !== 'object') return null;
  const { x, z, yaw } = value as Record<string, unknown>;
  const ok = (v: unknown, limit: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
  return ok(x, 9) && ok(z, 4.5) && ok(yaw, 10) ? { x, z, yaw: wrapAngle(yaw) } : null;
}

export interface StartEntry {
  slot: Slot;
  cfg: RobotConfig;
  /** The start its driver picked (red side), if any */
  start?: StartPose | null;
}

/**
 * Where each robot starts on the field (world poses). A driver's own start counts if G303 allows
 * it next to the starts already taken; everyone else gets their station's usual spot, or another
 * station's when a picked start is in the way.
 */
export function resolveStarts(entries: readonly StartEntry[], field: StartField): Map<Slot, StartPose> {
  const taken: Record<Alliance, Outline[]> = { red: [], blue: [] };
  const starts = new Map<Slot, StartPose>();
  const place = (e: StartEntry, p: StartPose) => {
    const alliance = slotAlliance(e.slot);
    starts.set(e.slot, forAlliance(p, alliance));
    taken[alliance].push(startOutline(p, e.cfg));
  };
  for (const e of entries) {
    if (e.start && !checkStart(e.start, e.cfg, field, taken[slotAlliance(e.slot)])) place(e, e.start);
  }
  for (const e of entries) {
    if (starts.has(e.slot)) continue;
    const station = slotStation(e.slot);
    const order = [station, ...([1, 2, 3] as const).filter(s => s !== station)];
    const spots = order.map(s => defaultStart(s, e.cfg.length, field));
    place(e, spots.find(p => !checkStart(p, e.cfg, field, taken[slotAlliance(e.slot)])) ?? spots[0]);
  }
  return starts;
}
