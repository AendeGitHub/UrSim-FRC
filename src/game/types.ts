export type Alliance = 'red' | 'blue';
export const ALLIANCES: Alliance[] = ['red', 'blue'];
export const other = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

/** Six robots: slots 0–2 red (DRIVER STATIONS 1–3), 3–5 blue. */
export const SLOTS = [0, 1, 2, 3, 4, 5] as const;
export type Slot = (typeof SLOTS)[number];
export const slotAlliance = (s: number): Alliance => (s < 3 ? 'red' : 'blue');
export const slotStation = (s: number): number => s % 3;

/** What a driver (or the robot's own program) asks of the robot for one step. */
export interface RobotInput {
  /** Field-centric drive, -1..1: x along the field, z across it */
  vx: number;
  vz: number;
  /** Turn, -1..1, counterclockwise seen from above positive */
  turn: number;
  intake: boolean;
  shoot: boolean;
  /** Hold to climb up the TOWER */
  climb: boolean;
}

export const idleInput = (): RobotInput => ({ vx: 0, vz: 0, turn: 0, intake: false, shoot: false, climb: false });
