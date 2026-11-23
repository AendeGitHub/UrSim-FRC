import { describe, expect, it } from 'vitest';
import { MATCH_LENGTH, autoTowerPoints, autoWinner, clock, emptyScore, formatClock, hubActive, periodAt, rankingPoints, total, towerPoints } from '../src/game/rules';
import { fieldCentric, moduleStates, toRobotFrame } from '../src/sim/swerve';
import { ballAt, solveShot } from '../src/sim/ballistics';
import { FIELD, HUB, fuelStarts } from '../src/game/field';

describe('match periods (manual Table 6-2)', () => {
  it('runs 2:40 with AUTO, TRANSITION, four SHIFTS and END GAME', () => {
    expect(MATCH_LENGTH).toBe(160);
    expect(periodAt(0).id).toBe('auto');
    expect(periodAt(19.9).id).toBe('auto');
    expect(periodAt(20).id).toBe('transition');
    expect(periodAt(30).id).toBe('shift1');
    expect(periodAt(55).id).toBe('shift2');
    expect(periodAt(80).id).toBe('shift3');
    expect(periodAt(105).id).toBe('shift4');
    expect(periodAt(130).id).toBe('endgame');
  });
  it('shows the arena clock: 0:20 down in AUTO, then 2:20 down', () => {
    expect(formatClock(clock(0))).toBe('0:20');
    expect(formatClock(clock(20))).toBe('2:20');
    expect(formatClock(clock(30))).toBe('2:10');
    expect(formatClock(clock(130))).toBe('0:30');
    expect(formatClock(clock(160))).toBe('0:00');
  });
});

describe('HUB status (manual Table 6-3)', () => {
  it('both HUBS are on in AUTO, TRANSITION and END GAME', () => {
    for (const p of ['auto', 'transition', 'endgame'] as const) {
      expect(hubActive('red', p, 'red')).toBe(true);
      expect(hubActive('blue', p, 'red')).toBe(true);
    }
  });
  it('the AUTO winner is off in SHIFT 1, then they take turns', () => {
    const red = ['shift1', 'shift2', 'shift3', 'shift4'].map(p => hubActive('red', p as 'shift1', 'red'));
    const blue = ['shift1', 'shift2', 'shift3', 'shift4'].map(p => hubActive('blue', p as 'shift1', 'red'));
    expect(red).toEqual([false, true, false, true]);
    expect(blue).toEqual([true, false, true, false]);
    expect(hubActive('red', 'shift1', 'blue')).toBe(true);
  });
  it('more AUTO FUEL wins AUTO; a tie is drawn', () => {
    expect(autoWinner({ red: 10, blue: 8 })).toBe('red');
    expect(autoWinner({ red: 3, blue: 8 })).toBe('blue');
    expect(autoWinner({ red: 5, blue: 5 }, () => 0.9)).toBe('blue');
  });
});

describe('points', () => {
  it('TOWER: 10 / 20 / 30 at the end, 15 per robot on level 1 in AUTO (two at most)', () => {
    expect(towerPoints([3, 2, 0])).toBe(50);
    expect(autoTowerPoints([1, 1, 1])).toBe(30);
    expect(autoTowerPoints([0, 2, 0])).toBe(15);
  });
  it('ranking points: win 3, ENERGIZED at 100 FUEL, SUPERCHARGED at 360, TRAVERSAL at 50 TOWER points', () => {
    const us = { ...emptyScore(), autoFuel: 40, teleFuel: 330, tower: 40, autoTower: 15 };
    const them = emptyScore();
    expect(total(us)).toBe(425);
    expect(rankingPoints(us, them)).toEqual({ win: 3, energized: true, supercharged: true, traversal: true, total: 6 });
    expect(rankingPoints(them, us).total).toBe(0);
  });
});

describe('swerve', () => {
  it('never asks for more than full speed with both sticks', () => {
    const s = fieldCentric(1, 1, 0, { maxSpeed: 4, maxOmega: 8 });
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(4);
  });
  it('field velocity to the robot frame', () => {
    expect(toRobotFrame(1, 0, 0)[0]).toBeCloseTo(1);
    // Facing +x, moving -z is moving to its left.
    expect(toRobotFrame(0, -1, 0)[1]).toBeCloseTo(1);
    // Turned a quarter left (facing -z), moving -z is forward.
    expect(toRobotFrame(0, -1, Math.PI / 2)[0]).toBeCloseTo(1);
  });
  it('turning in place points every wheel across its corner', () => {
    const m = moduleStates({ vx: 0, vz: 0, omega: 2 }, 0, 0.6, 5);
    for (const s of m) expect(s.speed).toBeCloseTo(2 * Math.hypot(0.3, 0.3));
  });
});

describe('ballistics', () => {
  it('a solved shot passes through the aim point', () => {
    const from: [number, number, number] = [0, 0.6, 0];
    const to: [number, number, number] = [3.5, 2.1, 1];
    const v = solveShot(from, to);
    const t = 0.62 + 0.085 * Math.hypot(3.5, 1);
    const p = ballAt(from, v, t);
    expect(p[0]).toBeCloseTo(to[0]);
    expect(p[1]).toBeCloseTo(to[1]);
    expect(p[2]).toBeCloseTo(to[2]);
  });
});

describe('field', () => {
  it('matches the manual: 16.54 m by 8.07 m, HUB opening 1.83 m up', () => {
    expect(FIELD.length).toBeCloseTo(16.54, 2);
    expect(FIELD.width).toBeCloseTo(8.07, 2);
    expect(HUB.height).toBeCloseTo(1.83, 2);
  });
  it('places 504 FUEL: 360 in the NEUTRAL ZONE pile', () => {
    const s = fuelStarts();
    expect(s.length).toBe(504);
    expect(s.filter(f => f.where === 'neutral').length).toBe(360);
    expect(s.filter(f => f.where === 'neutral').every(f => Math.abs(f.pos[2]) < 2.7 && Math.abs(f.pos[0]) < 1)).toBe(true);
  });
});
