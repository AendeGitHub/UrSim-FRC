// REBUILT match rules that need no physics: the periods (manual 6.4), which HUB is active
// (6.4.1), points (6.5) and ranking points. Pure functions, so they are easy to test.

import type { Alliance } from '../robot/robotConfig';

export const ALLIANCES: Alliance[] = ['red', 'blue'];
export const other = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

export type PeriodId = 'auto' | 'transition' | 'shift1' | 'shift2' | 'shift3' | 'shift4' | 'endgame';

export interface Period {
  id: PeriodId;
  /** Seconds from the start of the match */
  start: number;
  end: number;
  teleop: boolean;
}

/** AUTO 0:20, then TELEOP 2:20: TRANSITION 10 s, four 25 s SHIFTS, END GAME 30 s (Table 6-2). */
export const AUTO_LENGTH = 20;
export const PERIODS: Period[] = (() => {
  const list: [PeriodId, number][] = [
    ['auto', AUTO_LENGTH],
    ['transition', 10],
    ['shift1', 25],
    ['shift2', 25],
    ['shift3', 25],
    ['shift4', 25],
    ['endgame', 30],
  ];
  let t = 0;
  return list.map(([id, len]) => {
    const p = { id, start: t, end: t + len, teleop: id !== 'auto' };
    t += len;
    return p;
  });
})();
export const MATCH_LENGTH = PERIODS[PERIODS.length - 1].end;
/** FUEL that reaches a HUB up to 3 s after a period ends still counts as it would have then (6.5). */
export const SCORE_GRACE = 3;

export function periodAt(t: number): Period {
  for (const p of PERIODS) if (t < p.end) return p;
  return PERIODS[PERIODS.length - 1];
}

/** Seconds left on the arena clock: AUTO counts 0:20 down, then TELEOP counts 2:20 down. */
export function clock(t: number): number {
  return t < AUTO_LENGTH ? AUTO_LENGTH - t : Math.max(0, MATCH_LENGTH - t);
}

export function formatClock(seconds: number): string {
  const s = Math.ceil(Math.max(0, seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Whether `alliance`'s HUB is active in a period. Both are active in AUTO, TRANSITION and
 * END GAME. The alliance that scored more FUEL in AUTO starts SHIFT 1 inactive, then they take
 * turns (Table 6-3). `autoWinner` is null until AUTO ends.
 */
export function hubActive(alliance: Alliance, period: PeriodId, autoWinner: Alliance | null): boolean {
  const n = { shift1: 1, shift2: 2, shift3: 3, shift4: 4 }[period as 'shift1'];
  if (!n || !autoWinner) return true;
  const winnerActive = n % 2 === 0;
  return alliance === autoWinner ? winnerActive : !winnerActive;
}

/** The AUTO winner from FUEL scored in AUTO; a tie is drawn at random by the field (6.4.1). */
export function autoWinner(autoFuel: Record<Alliance, number>, coin: () => number = Math.random): Alliance {
  if (autoFuel.red !== autoFuel.blue) return autoFuel.red > autoFuel.blue ? 'red' : 'blue';
  return coin() < 0.5 ? 'red' : 'blue';
}

/** Points (6.5, cheat sheet). */
export const POINTS = {
  fuel: 1,
  autoTowerL1: 15,
  tower: [0, 10, 20, 30] as const,
  minorFoul: 5,
  majorFoul: 15,
} as const;

/** At most two robots per alliance earn the AUTO TOWER points. */
export const AUTO_TOWER_MAX = 2;

/** Ranking point thresholds in qualification matches. */
export const RP = {
  win: 3,
  tie: 1,
  energized: 100,
  supercharged: 360,
  traversal: 50,
} as const;

/** TOWER points for the robots' levels at the end of the match (0 = not climbed). */
export function towerPoints(levels: number[]): number {
  return levels.reduce((sum, l) => sum + POINTS.tower[Math.max(0, Math.min(3, l))], 0);
}

/** AUTO TOWER points: 15 for each robot on level 1 or higher, two robots at most. */
export function autoTowerPoints(levels: number[]): number {
  return Math.min(AUTO_TOWER_MAX, levels.filter(l => l >= 1).length) * POINTS.autoTowerL1;
}
