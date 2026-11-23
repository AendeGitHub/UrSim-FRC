// Shared types for the simulation and the game.

import type { Alliance } from '../robot/robotConfig';

/** Driver stations: three a side; "1" is nearest the scoring table (the DEPOT side of the wall). */
export type Slot = 'red1' | 'red2' | 'red3' | 'blue1' | 'blue2' | 'blue3';
export const SLOTS: Slot[] = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];

export const slotAlliance = (slot: Slot): Alliance => (slot.startsWith('red') ? 'red' : 'blue');
export const slotStation = (slot: Slot): 1 | 2 | 3 => Number(slot.slice(-1)) as 1 | 2 | 3;

export const SLOT_NAMES: Record<Slot, string> = {
  red1: 'Red 1', red2: 'Red 2', red3: 'Red 3', blue1: 'Blue 1', blue2: 'Blue 2', blue3: 'Blue 3',
};

/** What a driver sends for their robot every frame. */
export interface RobotInput {
  /** Raw gamepad sticks (up = -1) */
  lx: number;
  ly: number;
  rx: number;
  fieldCentric: boolean;
  intake: boolean;
  eject: boolean;
  /** Feeds FUEL from the hopper into the shooter */
  transfer: boolean;
  /** One-shot presses; kept until the next physics step uses them */
  shooterOn: boolean;
  shooterOff: boolean;
  imuReset: boolean;
  /** Held at the TOWER: the climber goes up a level at a time; released, it holds */
  climb: boolean;
}

export const idleInput = (): RobotInput => ({
  lx: 0, ly: 0, rx: 0, fieldCentric: true,
  intake: false, eject: false, transfer: false, shooterOn: false, shooterOff: false, imuReset: false, climb: false,
});

/** Applies a newer input, keeping one-shot presses that have not been used yet. */
export function mergeInput(current: RobotInput, next: RobotInput): RobotInput {
  return {
    ...next,
    shooterOn: current.shooterOn || next.shooterOn,
    shooterOff: current.shooterOff || next.shooterOff,
    imuReset: current.imuReset || next.imuReset,
  };
}

export type GameMode = 'practice' | 'match';
