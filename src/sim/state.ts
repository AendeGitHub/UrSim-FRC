// World state for rendering.

import type { AllianceScore } from '../game/scoring';
import type { WheelPowers } from '../robot/mecanum';
import type { Alliance } from '../robot/robotConfig';
import type { Period } from './Match';
import type { ShooterStatus } from './Mechanisms';
import type { Slot } from './types';

/** A turret besides the main one: where it points and how fast its flywheel turns */
export interface TurretState {
  yaw: number;
  pitch: number;
  flywheel: number;
}

export interface RobotState {
  slot: Slot;
  /** Robot id (robots.ts) */
  robot: string;
  x: number;
  z: number;
  /** How high the climber has lifted it off the carpet, m */
  y: number;
  yaw: number;
  heading: number;
  speed: number;
  turretYaw: number;
  pitch: number;
  flywheel: number;
  intakeDir: number;
  /** Transfer wheels feeding the shooter */
  transfer: boolean;
  status: ShooterStatus;
  shotSpeed: number;
  shotDistance: number;
  powers: WheelPowers;
  /** Ball ids in the hopper, next to shoot first */
  stored: number[];
  /** Battery under load and the lowest it has been, V */
  voltage: number;
  minVoltage: number;
  /** The climber: 0 down; while hanging, how far up in levels (1.5: halfway to LEVEL 2) */
  climb: number;
  /** The TOWER level it has reached (0: none) */
  level: number;
  /** The other turrets, in order */
  extraTurrets: TurretState[];
}

export interface WorldState {
  time: number;
  period: Period;
  periodTime: number;
  /** Which HUBS are lit now */
  hubs: Record<Alliance, boolean>;
  /** The alliance that won AUTO (its HUB goes dark first), null until known */
  autoWinner: Alliance | null;
  score: Record<Alliance, AllianceScore>;
  robots: RobotState[];
  balls: {
    /** 0 field, 1 held, 2 out of play (in a CHUTE or inside a HUB) */
    states: Uint8Array;
    /** x, y, z, qx, qy, qz, qw per ball */
    transforms: Float32Array;
  };
}
