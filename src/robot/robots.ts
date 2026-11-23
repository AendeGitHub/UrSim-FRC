// Playable robots. FRC robots are built from blueprints (robot/custom.ts), the same way players
// build their own in the Workshop: a drive base with bumpers, intakes, a hopper, shooters on
// turrets and a climber.

import { DEFAULT_BLUEPRINT, customDefinition, type Blueprint } from './custom';
import type { RobotConfig } from './robotConfig';

/** Where the shooter is and how well it hits depending on distance to the target. */
export interface ShooterSpec {
  /** Shooter position on the robot: (forward, right) from the footprint center, m */
  at: [number, number];
  /** Height where balls leave the shooter, m */
  height: number;
  /** Distance from the turret axis to where balls leave, m */
  exit: number;
  /** Up to this distance (m) the robot hits almost every shot */
  sweetSpot: number;
  /** At this distance and beyond (m) shots scatter widely */
  maxRange: number;
  /** Turret angle (rad) at which the model's shooter points straight forward */
  modelYaw: number;
  /** How far the turret turns each way from where it rests before its cables stop it, rad */
  turretLimit: number;
  /** Where the turret rests, the middle of its turn: rad to the left of straight ahead (0 if not given) */
  facing?: number;
  /** FUEL a second it shoots while the transfer feeds it */
  fireRate: number;
  /**
   * How the ball spins as it leaves, as a fraction of rolling (its surface turning as fast as it
   * flies): 1 frontspin, 0 none, negative for backspin. It curves in the air (Magnus).
   */
  spin: number;
  /** The flywheel's mass, kg, if not the usual one (Mechanisms' SHOOTER.flywheelMass) */
  flywheelMass?: number;
}

/** A climber for the TOWER: the highest level it reaches and seconds a level. */
export interface ClimberSpec {
  levels: number;
  time: number;
}

export interface RobotSign {
  at: number;
  length: number;
  y: number;
  height: number;
  side: number;
}

/**
 * Where held balls show in the model (robot frame: forward, up, right; m), one place for each
 * ball on show, the first the next to be shot.
 */
export type Storage = [number, number, number][];

/** A turret and where the balls it shoots wait. */
export interface TurretDef {
  shooter: ShooterSpec;
  storage: Storage;
}

/** An intake at the back of the robot: it takes balls the robot backs over. */
export interface BackIntake {
  /** How far behind the footprint center its mouth is, m */
  back: number;
  /** How far to each side of the center line it takes balls, m */
  halfWidth: number;
  /** Seconds between balls it takes in */
  interval: number;
}

/** Drivetrain as the team describes it, for the robot card. */
export interface DriveSpec {
  /** Wheel speed, RPM */
  rpm: number;
  /** Wheel diameter, m */
  wheel: number;
}

export interface RobotDefinition {
  id: string;
  /** Robot name */
  name: string;
  team: string;
  /** FRC team number, on the bumpers */
  number: string;
  teamLogo: string;
  /** Fill around a logo that isn't square-on-white, to match its own background ('transparent' for a round one) */
  logoBackground?: string;
  /** The company that designed the robot, when it isn't a team's */
  by?: { name: string; logo: string; url: string };
  /** glTF model, or `custom:…` for a robot built of blocks (view/customModel.ts) */
  model: string;
  /** The same model simplified further, for Low graphics */
  lowModel: string;
  /** The team number on the bumpers: forward of the footprint center, height, size and side, m */
  sign: RobotSign;
  drive: DriveSpec;
  config: RobotConfig;
  shooter: ShooterSpec;
  /** FUEL the robot holds (G-rules don't limit it; the hopper does) */
  capacity: number;
  /** Forward distance of the intake's mouth from the footprint center, if not at its front edge, m */
  intakeFront?: number;
  /** Seconds between balls the intake takes in, if not the usual */
  intakeInterval?: number;
  /** How far to each side of the center line the intake's mouth takes balls, m */
  intakeHalfWidth?: number;
  /** Where the main turret's held balls show */
  storage: Storage;
  /** More turrets, each with its lane */
  extraTurrets?: TurretDef[];
  backIntake?: BackIntake;
  climber?: ClimberSpec;
  /** A robot built from a blueprint: what it was made from (robot/custom.ts) */
  custom?: Blueprint;
  /** The robot whose design this one was built from (both share a card on the robot select screen) */
  basedOn?: string;
}

/** A robot's turrets, the main one first. */
export const turretsOf = (def: RobotDefinition): TurretDef[] =>
  [{ shooter: def.shooter, storage: def.storage }, ...(def.extraTurrets ?? [])];

/** Wheel surface speed: wheel RPM / 60 · π · wheel diameter. */
export const wheelSpeed = ({ rpm, wheel }: DriveSpec) => (rpm / 60) * Math.PI * wheel;

const robot = (id: string, bp: Partial<Blueprint>): RobotDefinition => customDefinition(id, { ...DEFAULT_BLUEPRINT, ...bp });

/** A low turret swerve: under the TRENCH, shoots from anywhere in its ALLIANCE ZONE and climbs to LEVEL 3. */
export const SKYLINE = robot('skyline', {
  name: 'Skyline', team: 'Skyline', number: '', color: '#2b3a55', accent: '#f2b705',
  length: 0.82, width: 0.82, rpm: 1000, wheel: 0.102, mass: 56,
  intake: { width: 0.66, reach: 0.18, rate: 10 }, hopper: 45, climber: 3, climbTime: 2.2,
  turrets: [{ x: -0.08, z: 0, height: 0.47, facing: 0, range: 200, rate: 9, spin: -0.25 }],
});

/** Two fixed shooters side by side: aims with the robot, empties its hopper fast; too tall for the TRENCH, it takes the BUMPS. */
export const TWIN_FLYWHEEL = robot('twin-flywheel', {
  name: 'Twin Flywheel', team: 'Twin Flywheel', color: '#5a1f2b', accent: '#e8e8e8',
  length: 0.86, width: 0.86, rpm: 950, wheel: 0.102, mass: 58,
  intake: { width: 0.7, reach: 0.2, rate: 12 }, hopper: 55, climber: 2, climbTime: 2.6,
  turrets: [
    { x: -0.12, z: -0.16, height: 0.55, facing: 180, range: 0, rate: 7, spin: -0.25 },
    { x: -0.12, z: 0.16, height: 0.55, facing: 180, range: 0, rate: 7, spin: -0.25 },
  ],
});

/** Intakes at both ends and a quick turret: never turns round to collect, and fits under the TRENCH. */
export const DOUBLE_DECK = robot('double-deck', {
  name: 'Double Deck', team: 'Double Deck', color: '#20403a', accent: '#7fd1b9',
  length: 0.8, width: 0.8, rpm: 1050, wheel: 0.096, mass: 52,
  intake: { width: 0.6, reach: 0.14, rate: 9 }, backIntake: { width: 0.6, reach: 0.14, rate: 9 }, hopper: 35, climber: 1, climbTime: 1.6,
  turrets: [{ x: 0, z: 0, height: 0.47, facing: 90, range: 270, rate: 8, spin: 0 }],
});

/** A heavy tank drive that pushes, with a simple shooter and a LEVEL 2 climb. */
export const BULLDOZER = robot('bulldozer', {
  name: 'Bulldozer', team: 'Bulldozer', color: '#3b3b3b', accent: '#ff7a1a',
  length: 0.9, width: 0.84, drivetrain: 'tank', rpm: 760, wheel: 0.152, mass: 64,
  intake: { width: 0.74, reach: 0.12, rate: 8 }, hopper: 30, climber: 2, climbTime: 3,
  turrets: [{ x: -0.15, z: 0, height: 0.48, facing: 180, range: 0, rate: 5, spin: 0 }],
});

/** A light, quick mecanum robot: a small hopper, and it climbs to LEVEL 1 in AUTO. */
export const KIT_BOT = robot('kit-bot', {
  name: 'Kit Bot', team: 'Kit Bot', color: '#4a4f57', accent: '#3fa9f5',
  length: 0.78, width: 0.74, drivetrain: 'mecanum', rpm: 800, wheel: 0.152, mass: 42,
  intake: { width: 0.5, reach: 0.1, rate: 6 }, hopper: 20, climber: 1, climbTime: 1.8,
  turrets: [{ x: -0.1, z: 0, height: 0.45, facing: 180, range: 0, rate: 4, spin: 0 }],
});

// New robots go at the end: snapshots name a robot by its place in this list.
export const ROBOTS: RobotDefinition[] = [SKYLINE, TWIN_FLYWHEEL, DOUBLE_DECK, BULLDOZER, KIT_BOT];
export const DEFAULT_ROBOT_ID = SKYLINE.id;

/**
 * Robots players made in the Workshop (robot/custom.ts): their own (`custom-…`, saved in this
 * browser) and other players' in an online room (`x-…`, named by their blueprint). `custom` stands
 * for one this game doesn't have, e.g. in a replay or in the statistics.
 */
export const CUSTOM_ROBOT = 'custom';
export const isCustomRobotId = (id: unknown): id is string =>
  typeof id === 'string' && (id === CUSTOM_ROBOT || /^(custom|x)-[a-z0-9]{4,16}$/.test(id));

const customRobots = new Map<string, RobotDefinition>();

/** A player-made robot joins the game (or replaces its older version). */
export function addCustomRobot(def: RobotDefinition): void {
  customRobots.set(def.id, def);
}

export function removeCustomRobot(id: string): void {
  customRobots.delete(id);
}

// A robot this game doesn't know (another player's, in a replay): the default blocks.
addCustomRobot(customDefinition(CUSTOM_ROBOT, DEFAULT_BLUEPRINT));

/** A robot with its team, as rooms and the start screen show it (a robot without a team: its name). */
export const robotTitle = (def: RobotDefinition): string => (def.team === def.name ? def.name : `${def.team} · ${def.name}`);

export function robotById(id: string | undefined): RobotDefinition {
  const team = ROBOTS.find(r => r.id === id);
  if (team || !isCustomRobotId(id)) return team ?? SKYLINE;
  return customRobots.get(id) ?? customRobots.get(CUSTOM_ROBOT) ?? SKYLINE;
}
