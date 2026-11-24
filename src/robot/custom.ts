// Robots built from a handful of numbers (a Blueprint): the drive base with its bumpers, the
// intakes, the hopper, the shooters on their turrets and the climber make a RobotDefinition. The
// game's own robots are built this way (robot/robots.ts), and players make theirs in the Workshop.
// Its model is built of plain blocks (view/customModel.ts), or it is the player's own 3D file. The
// server checks the blueprints of robots brought into online rooms with cleanBlueprint(), so
// nothing here needs the DOM or three.js.

import type { DriveSpec, RobotDefinition, RobotSign, Storage, TurretDef } from './robots';
import { FUEL_RADIUS } from '../field/layout';

/** Wheel surface speed: wheel RPM / 60 · π · wheel diameter. */
const wheelSpeed = ({ rpm, wheel }: DriveSpec) => (rpm / 60) * Math.PI * wheel;

/** Swerve modules that steer each wheel, mecanum wheels, or a tank drive of plain wheels */
export type Drivetrain = 'mecanum' | 'swerve' | 'tank';
export const DRIVETRAINS: Drivetrain[] = ['swerve', 'mecanum', 'tank'];

export type MeshFormat = 'glb' | 'gltf' | 'obj' | 'stl';
export const MESH_FORMATS: MeshFormat[] = ['glb', 'gltf', 'obj', 'stl'];

/** The model's axis that points up (CAD programs differ: glTF is Y-up, many STL exports Z-up). */
export type UpAxis = 'y' | 'z' | '-y' | '-z' | 'x' | '-x';
export const UP_AXES: UpAxis[] = ['y', 'z', '-z', '-y', 'x', '-x'];

/** A 3D file the player uploaded to show instead of the blocks, and how it sits on the robot. */
export interface MeshFit {
  /** Where the file is kept in this browser (robot/customStore.ts) */
  id: string;
  /** The file's name, as the player knows it */
  file: string;
  format: MeshFormat;
  /** Metres per model unit */
  scale: number;
  up: UpAxis;
  /** Quarter turns to the left, so that the model's front faces the robot's */
  turn: number;
  /** The team number on the bumpers: a model may have its own */
  signs: boolean;
}

/** An intake: rollers that take FUEL off the carpet, over the bumper. */
export interface IntakePart {
  /** How wide its mouth takes balls and how far it reaches out past the bumpers, m */
  width: number;
  reach: number;
  /** Balls a second it takes in */
  rate: number;
}

/** A turret on the frame, with a flywheel shooter (a fixed shooter: range 0, the driver aims the robot). */
export interface TurretPart {
  /** Its axis forward of the frame's center and to the right of the center line, m */
  x: number;
  z: number;
  /** Where balls leave the shooter, above the carpet, m */
  height: number;
  /** Where it rests, the middle of its turn: degrees to the left of straight ahead */
  facing: number;
  /** How far it turns each way from there, degrees (0: not at all, the driver aims the robot) */
  range: number;
  /** FUEL a second it shoots */
  rate: number;
  /** ShooterSpec.spin: 1 frontspin, 0 none, negative backspin */
  spin: number;
}

export interface Blueprint {
  name: string;
  team: string;
  /** FRC team number for the bumpers (digits; empty: the name) */
  number: string;
  /** The frame's color and the mechanisms', #rrggbb (the bumpers are the alliance's) */
  color: string;
  accent: string;
  /** The robot with its bumpers: front to back, side to side, m */
  length: number;
  width: number;
  /** The drive base's frame box, m */
  frameHeight: number;
  drivetrain: Drivetrain;
  /** Wheel diameter, m, and wheel speed, RPM */
  wheel: number;
  rpm: number;
  /** kg, with bumpers and battery */
  mass: number;
  /** The intake at the front, and the second one at the back of a robot that takes balls both ways */
  intake: IntakePart;
  backIntake: IntakePart | null;
  /** FUEL the hopper holds */
  hopper: number;
  /** The TOWER level its climber reaches (0: none), and seconds a level */
  climber: number;
  climbTime: number;
  /** 1 to MAX_TURRETS shooters; the first is the main one, whose shots the HUD shows */
  turrets: TurretPart[];
  mesh: MeshFit | null;
}

type Range = { min: number; max: number; step: number };
type Ranges<T> = Record<{ [K in keyof T]: T[K] extends number ? K : never }[keyof T], Range>;

/** Each number's range and the step the Workshop changes it by (sizes in m). */
export const LIMITS: Ranges<Blueprint> = {
  // FRC (R101–R105): a frame perimeter of at most 110 in, bumpers ~3.5 in deep all round, under 30 in tall.
  length: { min: 0.6, max: 1.0, step: 0.005 },
  width: { min: 0.6, max: 1.0, step: 0.005 },
  frameHeight: { min: 0.05, max: 0.2, step: 0.005 },
  wheel: { min: 0.076, max: 0.152, step: 0.002 },
  rpm: { min: 300, max: 1100, step: 5 },
  mass: { min: 30, max: 66, step: 0.5 },
  hopper: { min: 8, max: 60, step: 1 },
  climber: { min: 0, max: 3, step: 1 },
  climbTime: { min: 0.8, max: 6, step: 0.1 },
};
export const INTAKE_LIMITS: Ranges<IntakePart> = {
  width: { min: 0.3, max: 1.0, step: 0.01 },
  reach: { min: 0, max: 0.3, step: 0.01 },
  rate: { min: 3, max: 15, step: 0.5 },
};
export const TURRET_LIMITS: Ranges<TurretPart> = {
  // Within the frame (and its width): cleanBlueprint() keeps it there.
  x: { min: -0.35, max: 0.35, step: 0.005 },
  z: { min: -0.35, max: 0.35, step: 0.005 },
  // R105: the robot stays under 30 in tall, turret included.
  height: { min: 0.3, max: 0.69, step: 0.005 },
  facing: { min: -180, max: 180, step: 15 },
  range: { min: 0, max: 360, step: 5 },
  rate: { min: 2, max: 15, step: 0.5 },
  spin: { min: -0.5, max: 1, step: 0.25 },
};
export const MAX_TURRETS = 4;

/** Fastest a player-made robot drives, m/s: a quick FRC swerve. */
export const MAX_SPEED = 5.4;
/** A turret's axis stays this far in from the frame's ends and the robot's sides, m */
const TURRET_MARGIN = 0.12;
/** The bumpers: how deep they stand out from the frame, their bottom and their height, m */
export const BUMPER = { depth: 0.085, bottom: 0.02, height: 0.13 };
/**
 * A tank drive's plain wheels grip better than mecanum rollers: it accelerates (and pushes) this much
 * harder. Swerve modules turn the robot this much slower: they steer their wheels round first.
 */
const TANK_GRIP = 1.25;
const SWERVE_TURN = 0.85;

export const DEFAULT_INTAKE: IntakePart = { width: 0.6, reach: 0.15, rate: 8 };
export const DEFAULT_TURRET: TurretPart = { x: -0.1, z: 0, height: 0.55, facing: 0, range: 180, rate: 6, spin: 0 };

export const DEFAULT_BLUEPRINT: Blueprint = {
  name: 'Robot',
  team: '',
  number: '',
  color: '#3d4450',
  accent: '#f5c518',
  length: 0.85,
  width: 0.85,
  frameHeight: 0.1,
  drivetrain: 'swerve',
  wheel: 0.102,
  rpm: 900,
  mass: 55,
  intake: DEFAULT_INTAKE,
  backIntake: null,
  hopper: 40,
  climber: 1,
  climbTime: 2.5,
  turrets: [DEFAULT_TURRET],
  mesh: null,
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const round = (v: number) => Math.round(v * 10000) / 10000;
/** A number within its range (`fallback` if `raw` isn't one). */
const inRange = (raw: unknown, fallback: number, { min, max }: Range) => round(clamp(typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback, min, max));
const fields = <T>(value: unknown) => (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof T, unknown>>;

/** Printable text, one line, at most `max` characters. */
function cleanText(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;
}

const cleanColor = (value: unknown, fallback: string) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);

function cleanMesh(value: unknown): MeshFit | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Partial<Record<keyof MeshFit, unknown>>;
  if (typeof m.id !== 'string' || !/^[a-z0-9]{4,24}$/.test(m.id) || !MESH_FORMATS.includes(m.format as MeshFormat)) return null;
  const scale = typeof m.scale === 'number' && Number.isFinite(m.scale) && m.scale > 0 ? clamp(m.scale, 1e-5, 100) : 1;
  return {
    id: m.id,
    file: cleanText(m.file, 60, 'model'),
    format: m.format as MeshFormat,
    scale,
    up: UP_AXES.includes(m.up as UpAxis) ? m.up as UpAxis : 'y',
    turn: typeof m.turn === 'number' && Number.isFinite(m.turn) ? ((Math.round(m.turn) % 4) + 4) % 4 : 0,
    signs: m.signs !== false,
  };
}

function cleanIntake(value: unknown): IntakePart {
  const v = fields<IntakePart>(value);
  return {
    width: inRange(v.width, DEFAULT_INTAKE.width, INTAKE_LIMITS.width),
    reach: inRange(v.reach, DEFAULT_INTAKE.reach, INTAKE_LIMITS.reach),
    rate: inRange(v.rate, DEFAULT_INTAKE.rate, INTAKE_LIMITS.rate),
  };
}

function cleanTurret(value: unknown): TurretPart {
  const v = fields<TurretPart>(value);
  const num = (key: keyof typeof TURRET_LIMITS) => inRange(v[key], DEFAULT_TURRET[key], TURRET_LIMITS[key]);
  return { x: num('x'), z: num('z'), height: num('height'), facing: num('facing'), range: num('range'), rate: num('rate'), spin: num('spin') };
}

/** The frame's length: the robot's without its bumpers, m */
const frameLength = (bp: Pick<Blueprint, 'length'>) => bp.length - 2 * BUMPER.depth;

/** How far from the frame's center a turret's axis may be: forward or back, and to either side, m */
export function turretBounds(bp: Pick<Blueprint, 'length' | 'width'>): [number, number] {
  return [Math.max(0, frameLength(bp) / 2 - TURRET_MARGIN), Math.max(0, (bp.width - 2 * BUMPER.depth) / 2 - TURRET_MARGIN)];
}

/**
 * A blueprint with every number inside its range and fitting the others (intakes no wider than the
 * robot, wheels that fit the frame, turrets on it…), or null when `value` isn't one at all. Missing
 * fields get the defaults. Cleaning a clean blueprint changes nothing.
 */
export function cleanBlueprint(value: unknown): Blueprint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof Blueprint, unknown>> & Record<string, unknown>;
  const num = (key: keyof typeof LIMITS) => inRange(v[key], DEFAULT_BLUEPRINT[key], LIMITS[key]);
  const turrets = (Array.isArray(v.turrets) ? v.turrets : []).slice(0, MAX_TURRETS).map(cleanTurret);
  const bp: Blueprint = {
    name: cleanText(v.name, 24, DEFAULT_BLUEPRINT.name),
    team: cleanText(v.team, 24),
    number: typeof v.number === 'string' ? v.number.replace(/\D/g, '').slice(0, 5) : '',
    color: cleanColor(v.color, DEFAULT_BLUEPRINT.color),
    accent: cleanColor(v.accent, DEFAULT_BLUEPRINT.accent),
    length: num('length'),
    width: num('width'),
    frameHeight: num('frameHeight'),
    drivetrain: DRIVETRAINS.includes(v.drivetrain as Drivetrain) ? v.drivetrain as Drivetrain : 'swerve',
    wheel: num('wheel'),
    rpm: Math.round(num('rpm')),
    mass: num('mass'),
    intake: cleanIntake(v.intake),
    backIntake: v.backIntake && typeof v.backIntake === 'object' ? cleanIntake(v.backIntake) : null,
    hopper: Math.round(num('hopper')),
    climber: Math.round(num('climber')),
    climbTime: num('climbTime'),
    turrets: turrets.length ? turrets : [cleanTurret(DEFAULT_TURRET)],
    mesh: cleanMesh(v.mesh),
  };
  // R101: the frame perimeter is at most 110 in.
  const frameWidth = bp.width - 2 * BUMPER.depth;
  const perimeter = 2 * (frameLength(bp) + frameWidth);
  if (perimeter > 110 * 0.0254 + 1e-6) {
    const k = (110 * 0.0254) / perimeter;
    bp.length = round(frameLength(bp) * k + 2 * BUMPER.depth);
    bp.width = round(frameWidth * k + 2 * BUMPER.depth);
  }
  for (const part of [bp.intake, bp.backIntake]) if (part) part.width = round(Math.min(part.width, bp.width));
  // Wheels a little apart at each end of the frame.
  bp.wheel = round(Math.min(bp.wheel, (frameLength(bp) - 0.1) / 2));
  // The turrets stand on the frame.
  const [bx, bz] = turretBounds(bp);
  for (const t of bp.turrets) {
    t.x = round(clamp(t.x, -bx, bx));
    t.z = round(clamp(t.z, -bz, bz));
    t.height = round(Math.max(t.height, FRAME_Y + bp.frameHeight + TURRET.foot + 0.05));
  }
  return bp;
}

/** The same robot without the uploaded model, as other players see it. */
export const withoutMesh = (bp: Blueprint): Blueprint => ({ ...bp, mesh: null });

/** A short name for a blueprint's contents (FNV-1a over its fields in a fixed order). */
export function blueprintHash(bp: Blueprint): string {
  const text = JSON.stringify((Object.keys(DEFAULT_BLUEPRINT) as (keyof Blueprint)[]).map(k => bp[k]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/** The id of another player's robot in an online room: the same on every computer. */
export const sharedRobotId = (bp: Blueprint): string => `x-${blueprintHash(withoutMesh(bp))}`;

// ---- turrets' places --------------------------------------------------------------

/** Neat layouts of 1 to 4 turrets: each turret's place from the middle of them all (forward, right), m. */
const PATTERNS: [number, number][][] = [
  [[0, 0]],
  [[0, -0.16], [0, 0.16]],
  [[-0.1, -0.16], [-0.1, 0.16], [0.14, 0]],
  [[-0.12, -0.16], [-0.12, 0.16], [0.12, -0.16], [0.12, 0.16]],
];

/**
 * The places of `n` turrets laid out neatly around `center` (forward, right of the frame's center).
 * The layout moves in to stay on the frame, squeezed only on a frame too small for it.
 */
function pattern(bp: Blueprint, n: number, center: [number, number]): [number, number][] {
  const bounds = turretBounds(bp);
  const offsets = PATTERNS[n - 1];
  const [cx, cz] = ([0, 1] as const).map(k => {
    const low = Math.min(...offsets.map(o => o[k]));
    const high = Math.max(...offsets.map(o => o[k]));
    return high - low > 2 * bounds[k] ? 0 : clamp(center[k], -bounds[k] - low, bounds[k] - high);
  });
  return offsets.map(([x, z]) => [round(clamp(cx + x, -bounds[0], bounds[0])), round(clamp(cz + z, -bounds[1], bounds[1]))]);
}

const middle = (turrets: TurretPart[]): [number, number] =>
  [turrets.reduce((s, t) => s + t.x, 0) / turrets.length, turrets.reduce((s, t) => s + t.z, 0) / turrets.length];

/** The turrets still stand as arrangeTurrets() put them (or as a robot with one has its turret). */
function arranged(bp: Blueprint): boolean {
  const places = pattern(bp, bp.turrets.length, middle(bp.turrets));
  return bp.turrets.every((t, i) => Math.hypot(t.x - places[i][0], t.z - places[i][1]) < 0.002);
}

/** The turrets laid out neatly where they are now, each keeping its own settings. */
export function arrangeTurrets(bp: Blueprint): TurretPart[] {
  const places = pattern(bp, bp.turrets.length, middle(bp.turrets));
  return bp.turrets.map((t, i) => ({ ...t, x: places[i][0], z: places[i][1] }));
}

/**
 * The turrets with one more, set like turret `like`. Laid out neatly they make room for it; moved
 * by the player they stay, and it goes where it is furthest from them.
 */
export function withTurret(bp: Blueprint, like: number): TurretPart[] {
  if (bp.turrets.length >= MAX_TURRETS) return bp.turrets;
  const turrets = [...bp.turrets, { ...bp.turrets[like] }];
  if (arranged(bp)) {
    const places = pattern(bp, turrets.length, middle(bp.turrets));
    return turrets.map((t, i) => ({ ...t, x: places[i][0], z: places[i][1] }));
  }
  const [bx, bz] = turretBounds(bp);
  const center = middle(bp.turrets);
  let best: [number, number] = center;
  let bestScore = -Infinity;
  for (let x = -bx; x <= bx + 1e-9; x += 0.01) {
    for (let z = -bz; z <= bz + 1e-9; z += 0.01) {
      // Furthest from the nearest turret; of equal places, the one nearest the others' middle.
      const score = Math.min(...bp.turrets.map(t => Math.hypot(t.x - x, t.z - z))) - 0.01 * Math.hypot(center[0] - x, center[1] - z);
      if (score > bestScore) {
        best = [round(x), round(z)];
        bestScore = score;
      }
    }
  }
  turrets[turrets.length - 1] = { ...turrets[turrets.length - 1], x: best[0], z: best[1] };
  return turrets;
}

/** The turrets without turret `i` (laid out neatly, the others close up). */
export function withoutTurret(bp: Blueprint, i: number): TurretPart[] {
  if (bp.turrets.length < 2) return bp.turrets;
  const turrets = bp.turrets.filter((_, k) => k !== i);
  if (!arranged(bp)) return turrets;
  const places = pattern(bp, turrets.length, middle(bp.turrets));
  return turrets.map((t, k) => ({ ...t, x: places[k][0], z: places[k][1] }));
}

// ---- the robot ---------------------------------------------------------------------

/** Wheels: how wide, how far in from the frame's ends, and the gap to the frame box, m */
export const WHEEL = { width: 0.05, inset: 0.03, gap: 0.01 };
/** The frame box's bottom above the carpet, m */
export const FRAME_Y = 0.03;
/** A turret: its foot below where balls leave, its top above it, and how far from its axis they leave, m */
export const TURRET = { foot: 0.1, above: 0.07, exit: 0.16 };
/** The hopper: room left for the intake at the front and the frame at the back, and its top under the shooters, m */
const HOPPER = { front: 0.2, back: 0.08, side: 0.05, under: 0.04, maxHeight: 0.36 };
/** Held FUEL on show in the hopper: a grid this far apart, at most this many places */
const STORE = { pitch: 0.155, max: 60 };
/** The climber's mast: its height above the frame and how far its hook reaches up beyond it, m */
export const CLIMBER = { mast: 0.3, travel: 1.25 };

const NO_SIGN: RobotSign = { at: 0, length: 0, y: 0, height: 0, side: 0 };

/** Where everything is on a player-made robot (robot frame: forward, up, right; m). */
export interface CustomLayout {
  /** The footprint's length, with the bumpers */
  total: number;
  frameLength: number;
  /** The frame's center, forward */
  frameX: number;
  /** Half the frame's width (inside the bumpers) */
  frameHalf: number;
  frameTop: number;
  /** The front intake's mouth, forward, and the back one's, if it has one */
  mouth: number;
  backMouth: number | null;
  /** The wheels' axles, forward of the frame's center (±) and out from the center line (±) */
  wheelX: number;
  wheelZ: number;
  /** Each turret: its axis (forward, right), the top of its tower and where the balls it holds sit */
  turrets: { at: [number, number]; towerTop: number; storage: Storage }[];
  /** The hopper over the frame: its ends (forward), half its width and its top */
  hopper: { back: number; front: number; halfZ: number; top: number };
  /** The climber's mast (forward of the center), if it has one */
  climberX: number | null;
  /** The team number on the bumpers' sides */
  sign: RobotSign;
}

export function layoutOf(bp: Blueprint): CustomLayout {
  const total = bp.length;
  const length = frameLength(bp);
  const frameX = 0;
  const frameHalf = bp.width / 2 - BUMPER.depth;
  const mouth = total / 2 + bp.intake.reach;
  const r = bp.wheel / 2;
  const wheelX = length / 2 - r - WHEEL.inset;
  const frameTop = FRAME_Y + bp.frameHeight;

  // The hopper fills the frame behind the intake, up to just under the lowest shooter.
  const lowest = Math.min(...bp.turrets.map(t => t.height - TURRET.foot));
  const hopper = {
    back: frameX - length / 2 + HOPPER.back,
    front: frameX + length / 2 - HOPPER.front,
    halfZ: frameHalf - HOPPER.side,
    top: Math.max(frameTop + 0.16, Math.min(frameTop + HOPPER.maxHeight, lowest - HOPPER.under)),
  };
  // Held FUEL on show through the hopper's clear walls: layer by layer from the bottom, each
  // turret's lane taking every n-th place, so the robot fills up evenly however the balls are split.
  const grid: [number, number, number][] = [];
  const nx = Math.max(1, Math.floor((hopper.front - hopper.back) / STORE.pitch));
  const nz = Math.max(1, Math.floor((hopper.halfZ * 2) / STORE.pitch));
  const ny = Math.max(1, Math.floor((hopper.top - frameTop) / STORE.pitch));
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      for (let z = 0; z < nz; z++) {
        grid.push([hopper.back + (x + 0.5) * ((hopper.front - hopper.back) / nx), frameTop + FUEL_RADIUS + 0.005 + y * STORE.pitch, -hopper.halfZ + (z + 0.5) * ((hopper.halfZ * 2) / nz)]);
      }
    }
  }
  const places = grid.slice(0, STORE.max);
  const lanes = Math.max(1, bp.turrets.length);
  const turrets = bp.turrets.map((t, k) => {
    const at: [number, number] = [frameX + t.x, t.z];
    const towerTop = t.height - TURRET.foot;
    const storage: Storage = places.filter((_, i) => i % lanes === k);
    return { at, towerTop, storage: storage.length ? storage : [places[0]] };
  });

  const sign = !bp.mesh || bp.mesh.signs ? { at: frameX, length: Math.min(0.42, length * 0.7), y: BUMPER.bottom + BUMPER.height / 2, height: BUMPER.height * 0.7, side: bp.width / 2 + 0.001 } : NO_SIGN;
  // The climber stands at the front of the hopper, where it reaches the RUNG with the robot facing the TOWER.
  const climberX = bp.climber > 0 ? hopper.front + 0.06 : null;
  return { total, frameLength: length, frameX, frameHalf, frameTop, mouth, backMouth: bp.backIntake ? -total / 2 - bp.backIntake.reach : null, wheelX, wheelZ: frameHalf - WHEEL.width / 2 - WHEEL.gap, turrets, hopper, climberX, sign };
}

/** Top speed: the motors' wheel speed, no faster than MAX_SPEED, m/s. */
export const topSpeed = (bp: Pick<Blueprint, 'rpm' | 'wheel'>) => Math.min(MAX_SPEED, wheelSpeed({ rpm: bp.rpm, wheel: bp.wheel }));

/**
 * The card picture of a robot without one of its own: the robot from the side, in its colors, as
 * blocks, with its turrets and intakes. An SVG data URL.
 */
export function blockLogo(bp: Blueprint): string {
  const n = bp.turrets.length;
  const w = n > 1 ? Math.min(20, 64 / n) : 28;
  const turrets = bp.turrets.map((t, i) => {
    const x = 12 + (70 * (i + 1)) / (n + 1) - w / 2;
    // The hood on the side the turret faces.
    const hood = Math.cos((t.facing * Math.PI) / 180) < 0 ? x - w * 0.4 : x + w * 0.9;
    return `<rect x="${x + w * 0.3}" y="26" width="${w * 0.4}" height="20" fill="${bp.accent}" opacity="0.8"/>
<rect x="${x}" y="16" width="${w}" height="12" rx="2" fill="${bp.accent}"/>
<rect x="${hood}" y="19" width="${w * 0.5}" height="5" fill="${bp.accent}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">
<rect width="100" height="80" rx="6" fill="#121733"/>
${turrets.join('\n')}
<rect x="12" y="44" width="70" height="16" rx="2" fill="${bp.color}"/>
<rect x="82" y="46" width="8" height="16" fill="${bp.accent}"/>
<rect x="8" y="56" width="78" height="7" rx="2" fill="#c8303a"/>
${bp.backIntake ? `<rect x="4" y="46" width="8" height="16" fill="${bp.accent}"/>` : ''}
<circle cx="27" cy="61" r="9" fill="#1d1f22"/><circle cx="27" cy="61" r="3" fill="#9aa3ad"/>
<circle cx="67" cy="61" r="9" fill="#1d1f22"/><circle cx="67" cy="61" r="3" fill="#9aa3ad"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The robot a blueprint makes, under `id`. `logo`: a picture of it for its card (by default the
 * block drawing).
 */
export function customDefinition(id: string, bp: Blueprint, logo?: string): RobotDefinition {
  const g = layoutOf(bp);
  const drive: DriveSpec = { rpm: bp.rpm, wheel: bp.wheel };
  const [main, ...extra] = bp.turrets.map((t, i): TurretDef => ({
    shooter: {
      at: g.turrets[i].at,
      height: t.height,
      exit: TURRET.exit,
      // A good FRC shooter hits nearly everything from across its ALLIANCE ZONE.
      sweetSpot: 3.2,
      maxRange: 6.5,
      modelYaw: 0,
      facing: (t.facing * Math.PI) / 180,
      turretLimit: (t.range * Math.PI) / 180,
      // The shooters share the hopper: each feeds at its own rate.
      fireRate: t.rate,
      spin: t.spin,
    },
    storage: g.turrets[i].storage,
  }));
  const name = bp.name || DEFAULT_BLUEPRINT.name;
  // The model doesn't change with the name, team or number: those are on the bumpers RobotView paints.
  const model = `custom:${id}#${blueprintHash({ ...bp, name: '', team: '', number: '' })}`;
  return {
    id,
    name,
    team: bp.team || name,
    number: bp.number || name,
    teamLogo: logo ?? blockLogo(bp),
    logoBackground: 'transparent',
    model,
    lowModel: model,
    sign: g.sign,
    drive,
    config: {
      name,
      length: g.total,
      width: bp.width,
      height: Math.max(...bp.turrets.map(t => t.height)) + TURRET.above,
      mass: bp.mass,
      wheelRadius: bp.wheel / 2,
      drive: {
        maxWheelSpeed: topSpeed(bp),
        // Mecanum rollers lose some speed sideways, swerve modules none; a tank drive doesn't strafe.
        strafeEfficiency: bp.drivetrain === 'mecanum' ? 0.85 : bp.drivetrain === 'swerve' ? 1 : 0,
        trackWidth: 2 * g.wheelZ,
        wheelBase: 2 * g.wheelX,
        ...(bp.drivetrain === 'mecanum' ? {} : { type: bp.drivetrain }),
      },
      // FRC traction: lighter robots accelerate and turn harder on the same carpet.
      maxAccel: clamp(11 - (bp.mass - 45) * 0.12, 7, 12) * (bp.drivetrain === 'tank' ? TANK_GRIP : 1),
      maxTurnAccel: clamp(30 - (bp.mass - 45) * 0.4, 18, 34) * (bp.drivetrain === 'swerve' ? SWERVE_TURN : 1),
    },
    shooter: main.shooter,
    storage: main.storage,
    extraTurrets: extra.length ? extra : undefined,
    capacity: bp.hopper,
    intakeFront: g.mouth,
    intakeInterval: 1 / bp.intake.rate,
    intakeHalfWidth: bp.intake.width / 2,
    backIntake: bp.backIntake ? { back: -g.backMouth!, halfWidth: bp.backIntake.width / 2, interval: 1 / bp.backIntake.rate } : undefined,
    climber: bp.climber > 0 ? { levels: bp.climber, time: bp.climbTime } : undefined,
    custom: bp,
  };
}

/** What the share code of a robot starts with. */
export const SHARE_PREFIX = 'URSIM-ROBOT:';

/** A robot as text to paste into a chat: its blueprint without the model (that stays a file). */
export function shareCode(bp: Blueprint): string {
  const bytes = new TextEncoder().encode(JSON.stringify(withoutMesh(bp)));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return SHARE_PREFIX + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The blueprint in a share code, or null when the text isn't one. */
export function readShareCode(text: string): Blueprint | null {
  const at = text.indexOf(SHARE_PREFIX);
  if (at < 0) return null;
  const code = text.slice(at + SHARE_PREFIX.length).trim().split(/\s/)[0].replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(code + '='.repeat((4 - (code.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    return cleanBlueprint({ ...JSON.parse(json), mesh: null });
  } catch {
    return null;
  }
}
